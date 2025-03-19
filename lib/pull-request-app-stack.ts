import * as cdk from "aws-cdk-lib";
import {
  Deployment,
  LambdaIntegration,
  MethodLoggingLevel,
  RestApi,
  Stage,
} from "aws-cdk-lib/aws-apigateway";
import { EventBus, Rule, RuleTargetInput } from "aws-cdk-lib/aws-events";
import { SfnStateMachine } from "aws-cdk-lib/aws-events-targets";
import {
  AnyPrincipal,
  Effect,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { DefinitionBody, StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { LambdaInvoke } from "aws-cdk-lib/aws-stepfunctions-tasks";
import { Construct } from "constructs";
import path = require("path");

export class PullRequestAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const githubTokenSecret = new Secret(this, "githubToken", {
      secretName: "githubToken",
    });

    const githubPKSecret = new Secret(this, "githubPK", {
      secretName: "githubPK",
    });

    const lambdaEventBridgeRole = new Role(this, "LambdaEventBridgeRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });

    const eventBus = new EventBus(this, "prEventBus", {
      eventBusName: "prEventBus",
    });

    lambdaEventBridgeRole.addToPolicy(
      new PolicyStatement({
        actions: ["events:PutEvents"],
        resources: ["*"],
      })
    );
    lambdaEventBridgeRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["arn:aws:logs:*:*:*"],
      })
    );
    eventBus.grantPutEventsTo(lambdaEventBridgeRole);

    const verificationLambda = new NodejsFunction(this, "VerificationLambda", {
      runtime: Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../lambda/lambdaVerification/index.ts"),
      handler: "index.handler",
      environment: {
        WEBHOOK_SECRET: githubTokenSecret.secretName,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
      role: lambdaEventBridgeRole,
    });
    githubTokenSecret.grantRead(verificationLambda);

    const aiReviewRole = new Role(this, "AiReviewLambdaRole", {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });

    aiReviewRole.addToPolicy(
      new PolicyStatement({
        actions: ["events:PutEvents"],
        resources: ["*"],
      })
    );
    aiReviewRole.addToPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        resources: ["arn:aws:logs:*:*:*"],
      })
    );
    aiReviewRole.addToPolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel"],
        resources: [
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20240620-v1:0",
        ],
      })
    );

    aiReviewRole.addToPolicy(
      new PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [githubPKSecret.secretArn],
      })
    );

    const aiReviewLambda = new NodejsFunction(this, "AiReviewLambda", {
      runtime: Runtime.NODEJS_22_X,
      handler: "index.handler",
      entry: path.join(__dirname, "/../lambda/lambdaAiReview/index.ts"),
      environment: {
        GITHUB_PK_SECRET_NAME: githubPKSecret.secretName,
        BEDROCK_REGION: "us-east-1",
      },
      role: aiReviewRole,
    });
    githubPKSecret.grantRead(aiReviewLambda);

    const slackNotificationLambda = new NodejsFunction(
      this,
      "SlackNotificationLambda",
      {
        runtime: Runtime.NODEJS_22_X,
        handler: "index.handler",
        entry: path.join(
          __dirname,
          "/../lambda/lambdaSlackNotification/index.ts"
        ),
        environment: {
          SLACK_WEBHOOK_URL: "YOUR_SLACK_WEBHOOK_URL",
        },
        role: lambdaEventBridgeRole,
      }
    );

    const aiReviewTask = new LambdaInvoke(this, "AIReviewTask", {
      lambdaFunction: aiReviewLambda,
    });

    const slackNotificationTask = new LambdaInvoke(
      this,
      "SlackNotificationTask",
      {
        lambdaFunction: slackNotificationLambda,
      }
    );

    const stateMachine = new StateMachine(this, "AIRReviewStateMachine", {
      definitionBody: DefinitionBody.fromChainable(
        aiReviewTask.next(slackNotificationTask)
      ),
    });
    stateMachine.grantStartExecution(
      new cdk.aws_iam.ServicePrincipal("events.amazonaws.com")
    );
    const rule = new Rule(this, "GithubPullRequestRule", {
      eventBus: eventBus,
      eventPattern: {
        source: ["github.webhook"],
        detailType: ["github.pull_request"],
      },
    });

    rule.addTarget(
      new SfnStateMachine(stateMachine, {
        input: RuleTargetInput.fromEventPath("$.detail"),
      })
    );

    const api = new RestApi(this, "GithubWebhookApi", {
      restApiName: "Github Webhook API",
      description: "API to receive GitHub webhooks and forward to EventBridge",
      policy: new PolicyDocument({
        statements: [
          new PolicyStatement({
            effect: Effect.ALLOW,
            principals: [new AnyPrincipal()],
            actions: ["execute-api:Invoke"],
            resources: ["execute-api:/*"],
            conditions: {
              IpAddress: {
                "aws:SourceIp": [
                  "192.30.252.0/22",
                  "185.199.108.0/22",
                  "140.82.112.0/20",
                  "143.55.64.0/20",
                  "2a0a:a440::/29",
                  "2606:50c0::/32",
                ],
              },
            },
          }),
        ],
      }),
    });

    verificationLambda.addPermission("ApiGatewayInvoke", {
      principal: new ServicePrincipal("apigateway.amazonaws.com"),
      action: "lambda:InvokeFunction",
      sourceArn: api.arnForExecuteApi(),
    });

    const webhookResource = api.root.addResource("webhook");

    webhookResource.addMethod(
      "POST",
      new LambdaIntegration(verificationLambda)
    );

    const deployment = new Deployment(this, "ApiDeployment", {
      api: api,
    });

    const stage = new Stage(this, "ApiStage", {
      deployment: deployment,
      stageName: "dev",
      loggingLevel: MethodLoggingLevel.INFO,
    });

    stage.node.addDependency(verificationLambda);
  }
}

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import axios from "axios";
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

interface GithubSecret {
  appId: string;
  privateKey: string;
}

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_REGION,
});
const secretsClient = new SecretsManagerClient({});

export const handler = async (event: any) => {
  try {
    const detail = JSON.parse(event.body).detail;
    const owner = detail.repository.owner.login;
    const repo = detail.repository.name;
    const pullNumber = detail.number;
    const commitId = detail.pull_request.head.sha;
    const installationId = detail.installation.id;

    const diffUrl = detail.pull_request.diff_url;
    const diffResponse = await axios.get(diffUrl);
    const diff = diffResponse.data;

    console.log("event", event);
    console.log("detail", detail);

    const prompt = `Review the following code diff and provide feedback. For each issue you find, please provide:
      - A detailed comment explaining the issue.
      - The file path where the issue occurs.
      - The line number(s) where the issue is located.

      I expect you to format your response as a JSON array, where each object has the following structure:
      {
        'comment': '...',
        'filePath': '...',
        'lineNumber': '...'
      }
      
      The whole response has to be in the format a JSON array.

      If there are no issues, please provide an empty JSON array.

      Code diff: \n\n${diff}`;

    const input = {
      modelId: "amazon.nova-lite-v1:0",
      messages: [prompt],
      inferenceConfig: {
        maxTokens: 1024,
        temperature: 0.5,
      },
    };

    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const reviewResults = JSON.parse(responseBody.completion);

    const secretCommand = new GetSecretValueCommand({
      SecretId: process.env.GITHUB_TOKEN_SECRET_NAME,
    });
    const secretResponse = await secretsClient.send(secretCommand);

    if (!secretResponse.SecretString) {
      throw new Error("Secret not found");
    }

    const githubPK = JSON.parse(
      secretResponse.SecretString
    ) satisfies GithubSecret;

    const auth = createAppAuth({
      appId: githubPK.appId,
      privateKey: githubPK.privateKey,
      installationId: installationId,
    });

    const authentication = await auth({ type: "installation" });

    const octokit = new Octokit({ auth: authentication.token });

    // for (const review of reviewResults) {
    //   if (review.comment && review.filePath && review.lineNumber) {
    //     await octokit.rest.pulls.createReviewComment({
    //       owner: owner,
    //       repo: repo,
    //       pull_number: pullNumber,
    //       body: review.comment,
    //       commit_id: commitId,
    //       path: review.filePath,
    //       position: review.lineNumber,
    //     });
    //   }
    // }

    return {
      status: "success",
      body: JSON.stringify(detail),
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      status: "failed",
      body: JSON.stringify({
        message: "AI review or comment failed",
        error: error,
      }),
    };
  }
};

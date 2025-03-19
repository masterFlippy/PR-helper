#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PullRequestAppStack } from "../lib/pull-request-app-stack";
import * as dotenv from "dotenv";

dotenv.config();

const app = new cdk.App();
new PullRequestAppStack(app, "PullRequestAppStack", {
  env: { account: process.env.AWS_ACCOUNT_ID, region: process.env.REGION },
});

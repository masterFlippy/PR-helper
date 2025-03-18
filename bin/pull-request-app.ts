#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { PullRequestAppStack } from "../lib/pull-request-app-stack";

const app = new cdk.App();
new PullRequestAppStack(app, "PullRequestAppStack", {
  env: { account: "xx", region: "us-east-1" },
});

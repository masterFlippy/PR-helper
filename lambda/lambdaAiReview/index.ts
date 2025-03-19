import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import axios from "axios";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { getSecret } from "../../utils/aws";
interface GitHubEvent {
  pull_request: {
    draft: boolean;
    merged: boolean;
    head: { sha: string };
    diff_url: string;
  };
  action: string;
  installation: { id: string };
  repository: { owner: { login: string }; name: string };
  number: number;
}
interface GithubSecret {
  appId: string;
  privateKey: string;
}

interface ClaudeInput {
  modelId: string;
  contentType: string;
  accept: string;
  body: string;
}

const bedrockClient = new BedrockRuntimeClient({
  region: process.env.BEDROCK_REGION,
});

export const handler = async (event: GitHubEvent) => {
  try {
    const isDraft = event.pull_request.draft;
    const isMerged = event.pull_request.merged;
    const action = event.action;

    if (["closed", "assigned"].includes(action) || isDraft || isMerged) {
      return { status: "success", body: JSON.stringify(event) };
    }

    const owner = event.repository.owner.login;
    const repo = event.repository.name;
    const pullNumber = event.number;
    const commitId = event.pull_request.head.sha;
    const installationId = event.installation.id;

    const secretName = process.env.GITHUB_PK_SECRET_NAME;
    if (!secretName) {
      throw new Error("GitHub private key secret name not found");
    }

    const githubSecret = await getSecret<GithubSecret>(secretName, "json");

    const auth = createAppAuth({
      appId: githubSecret.appId,
      privateKey: githubSecret.privateKey,
      installationId: installationId,
    });

    const authentication = await auth({ type: "installation" });
    const octokit = new Octokit({ auth: authentication.token });
    const previousComments = await octokit.pulls.listReviewComments({
      owner,
      repo,
      pull_number: pullNumber,
    });
    const previousCommentTexts = previousComments.data.map(
      (comment) => comment.body
    );

    let diffUrl;
    if (action === "opened") {
      diffUrl = event.pull_request.diff_url;
    } else {
      const commits = await octokit.rest.pulls.listCommits({
        owner,
        repo,
        pull_number: pullNumber,
      });

      const latestCommit = commits.data[commits.data.length - 1];
      const latestCommitSha = latestCommit.sha;
      diffUrl = `https://github.com/${owner}/${repo}/commit/${latestCommitSha}.diff`;
    }

    if (!diffUrl) {
      throw new Error("No diff URL available for the pull request");
    }

    const diffResponse = await axios.get(diffUrl);
    const diff = diffResponse.data;

    const prompt = `### Task
    You are a code review assistant. Analyze the following code diff and provide feedback.
    
    ### Instructions
    - Identify **potential issues, improvements, or errors** in the code diff.
    - **STRICTLY output a JSON array—NO explanations, NO introductions, NO extra text.**
    - If there are issues, return a **JSON array** where each object contains:
      - **"comment"** → A detailed issue description.
      - **"filePath"** → The affected file path.
      - **"lineNumber"** → The affected line number. If there are more than one, choose the last line number.
      
    - **DO NOT add comments that are similar to any previous comments.** If the new comment is similar to any previous comment, do not include it in the output. Focus on **new, unique feedback** only.
    
    ### **Output Format**
    - **If there are issues**, return:
    \`\`\`json
    [
      {
        "comment": "Description of the issue",
        "filePath": "path/to/file",
        "lineNumber": "42"
      }
    ]
    \`\`\`
    - **If there are NO issues**, return **exactly**:
    \`\`\`json
    []
    \`\`\`
    - **DO NOT include anything else—no introductions, no summaries, no explanations.**
    - **Your entire response must be a valid JSON array, nothing before or after it.**
    
    #### **Previous Comments**
    ${
      previousCommentTexts.length > 0
        ? previousCommentTexts.join("\n")
        : "No previous comments"
    }
    
    #### **Code Diff**
    \`\`\`
        ${diff}
    \`\`\`
    `;

    const input: ClaudeInput = {
      modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1024,
        temperature: 0.5,
      }),
    };

    const command = new InvokeModelCommand(input);
    const response = await bedrockClient.send(command);

    if (!response.body) {
      throw new Error("Empty response body from AI model");
    }

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const parsedBody = JSON.parse(responseBody.content[0].text);
    for (const review of parsedBody) {
      if (review.comment && review.filePath && review.lineNumber) {
        await octokit.rest.pulls.createReviewComment({
          owner,
          repo,
          pull_number: pullNumber,
          body: review.comment,
          commit_id: commitId,
          path: review.filePath,
          line: Number(review.lineNumber),
        });
      }
    }

    return {
      status: "success",
      body: event,
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

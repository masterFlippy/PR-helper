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
  region: "us-east-1",
});
const secretsClient = new SecretsManagerClient({});

export const handler = async (event: any) => {
  try {
    const owner = event.repository.owner.login;
    const repo = event.repository.name;
    const pullNumber = event.number;
    const commitId = event.pull_request.head.sha;
    const installationId = event.installation.id;

    const diffUrl = event.pull_request.diff_url;
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
  - **"lineNumber"** → The affected line number. If there are more than one. Choose the last line number

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

#### **Code Diff**
\`\`\`
    ${diff}
    \`\`\`
    `;

    const input = {
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

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const secretCommand = new GetSecretValueCommand({
      SecretId: process.env.GITHUB_PK_SECRET_NAME,
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

    for (const review of responseBody.content) {
      if (review.comment && review.filePath && review.lineNumber) {
        await octokit.rest.pulls.createReviewComment({
          owner: owner,
          repo: repo,
          pull_number: pullNumber,
          body: review.comment,
          commit_id: commitId,
          path: review.filePath,
          position: review.lineNumber,
        });
      }
    }

    return {
      status: "success",
      body: JSON.stringify(event),
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

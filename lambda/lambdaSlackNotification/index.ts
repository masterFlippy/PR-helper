import axios from "axios";
interface GitHubPullRequestPayload {
  action: string;
  repository: {
    owner: {
      login: string;
    };
    name: string;
  };
  number: number;
  pull_request: {
    head: {
      sha: string;
    };
    title: string;
    html_url: string;
    merged?: boolean;
  };
  sender: {
    login: string;
  };
}
interface Event {
  Payload: { status: "success" | "failed"; body: string };
}

export const handler = async (event: Event) => {
  const githubPullRequestPayload: GitHubPullRequestPayload = JSON.parse(
    event.Payload.body
  );
  try {
    if (githubPullRequestPayload.action === "assigned") {
      return {
        statusCode: 200,
      };
    }
    const owner = githubPullRequestPayload.repository.owner.login;
    const repo = githubPullRequestPayload.repository.name;
    const pullNumber = githubPullRequestPayload.number;
    const pullRequestTitle = githubPullRequestPayload.pull_request.title;
    const pullRequestUrl = githubPullRequestPayload.pull_request.html_url;
    const sender = githubPullRequestPayload.sender.login;

    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (!slackWebhookUrl) {
      throw new Error("Slack webhook URL not found");
    }

    let slackMessage = { text: "" };
    switch (githubPullRequestPayload.action) {
      case "opened":
        slackMessage = {
          text: `🎉 New pull request opened by ${sender} in ${owner}/${repo}: ${pullRequestTitle} - <${pullRequestUrl}|View PR>`,
        };
        break;
      case "closed":
        if (githubPullRequestPayload.pull_request.merged) {
          slackMessage = {
            text: `✅ Pull request #${pullNumber} in ${owner}/${repo} was merged.`,
          };
        } else {
          slackMessage = {
            text: `❌ Pull request #${pullNumber} in ${owner}/${repo} was closed without merging.`,
          };
        }
        break;
      case "review_requested":
        slackMessage = {
          text: `👀 Pull request #${pullNumber} in ${owner}/${repo} requires a review.`,
        };
        break;
      case "approved":
        slackMessage = {
          text: `👍 Pull request #${pullNumber} in ${owner}/${repo} was approved.`,
        };
        break;
      case "synchronize":
        slackMessage = {
          text: `🔄 Pull request #${pullNumber} in ${owner}/${repo} was updated.`,
        };
        break;
      default:
        slackMessage = {
          text: `Pull request #${pullNumber} in ${owner}/${repo} received an event: ${githubPullRequestPayload.action}`,
        };
        break;
    }

    if (
      event.Payload.status === "success" &&
      (githubPullRequestPayload.action === "synchronize" ||
        githubPullRequestPayload.action === "opened")
    ) {
      slackMessage.text += "\n\n✅ AI review completed.";
    }

    await axios.post(slackWebhookUrl, slackMessage);
    return {
      statusCode: 200,
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Slack notification failed",
        error: error,
      }),
    };
  }
};

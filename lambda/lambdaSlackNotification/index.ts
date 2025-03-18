import axios from "axios";

interface IEvent {
  status: "success" | "failed";
  body: any;
}
interface Detail {
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

export const handler = async (event: IEvent) => {
  try {
    // add if failed send to event bridge with error message and what to do with it
    // if (event.status === "failed") {

    const detail: Detail = JSON.parse(event.body);
    const owner = detail.repository.owner.login;
    const repo = detail.repository.name;
    const pullNumber = detail.number;
    const pullRequestTitle = detail.pull_request.title;
    const pullRequestUrl = detail.pull_request.html_url;
    const sender = detail.sender.login;

    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

    if (!slackWebhookUrl) {
      throw new Error("Slack webhook URL not found");
    }

    let slackMessage = { text: "" };
    switch (detail.action) {
      case "opened":
        slackMessage = {
          text: `🎉 New pull request opened by ${sender} in ${owner}/${repo}: ${pullRequestTitle} - <${pullRequestUrl}|View PR>`,
        };
        break;
      case "closed":
        if (detail.pull_request.merged) {
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
          text: `🔄 Pull request #${pullNumber} in ${owner}/${repo} was synchronized.`,
        };
        break;
      // Add more cases for other event types as needed
      default:
        slackMessage = {
          text: `Pull request #${pullNumber} in ${owner}/${repo} received an event: ${detail.action}`,
        };
        break;
    }

    if (event.status === "success") {
      slackMessage.text += "\n\n✅ AI review completed.";
    }

    await axios.post(slackWebhookUrl, slackMessage);
    return {
      statusCode: 200,
    };
  } catch (error) {
    // hadnle erro. send to event bridge ?
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

import * as crypto from "crypto";

import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import { getSecret } from "../../utils/aws";

const client = new EventBridgeClient({ region: "eu-north-1" });

export const handler = async (event: any) => {
  try {
    const secretName = process.env.WEBHOOK_SECRET;

    if (!secretName) {
      throw new Error("Webhook secret name not found");
    }

    const webhookSecret = await getSecret(secretName, "string");

    const signature = event.headers["X-Hub-Signature-256"]!;

    const body = event.body!;
    const parsedBody = JSON.parse(body);

    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(body);
    const expectedSignature = `sha256=${hmac.digest("hex")}`;

    if (signature !== expectedSignature) {
      console.error("Signature verification failed");
      return {
        statusCode: 403,
        body: JSON.stringify({ message: "Forbidden" }),
      };
    }

    const params = {
      Entries: [
        {
          Source: "github.webhook",
          DetailType: "github.pull_request",
          Detail: JSON.stringify(parsedBody),
          EventBusName: process.env.EVENT_BUS_NAME,
        },
      ],
    };
    const command = new PutEventsCommand(params);

    await client.send(command);
    return { statusCode: 200, body: JSON.stringify({ message: "OK" }) };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal Server Error" }),
    };
  }
};

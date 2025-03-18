import * as crypto from "crypto";

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";

const client = new EventBridgeClient({ region: "REGION" });
const secretsClient = new SecretsManagerClient({});

export const handler = async (event: any) => {
  try {
    const secretCommand = new GetSecretValueCommand({
      SecretId: process.env.WEBHOOK_SECRET,
    });
    const secretResponse = await secretsClient.send(secretCommand);

    if (!secretResponse.SecretString) {
      throw new Error("Secret not found");
    }

    const webhookSecret = secretResponse.SecretString;

    const signature = event.headers["x-hub-signature-256"]!;
    const body = event.body!;

    const hmac = crypto.createHmac("sha256", webhookSecret);
    hmac.update(body);
    const expectedSignature = `sha256=${hmac.digest("hex")}`;

    if (signature !== expectedSignature) {
      // TODO: change to throw new Error
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
          Detail: JSON.stringify(body),
          EventBusName: "default",
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

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({});
export async function getSecret<T>(
  secretName: string,
  secretType: "json"
): Promise<T>;
export async function getSecret(
  secretName: string,
  secretType: "string"
): Promise<string>;
export async function getSecret<T>(
  secretName: string,
  secretType: "json" | "string" = "json"
): Promise<T | string> {
  try {
    const secretCommand = new GetSecretValueCommand({
      SecretId: secretName,
    });
    const secretResponse = await secretsClient.send(secretCommand);

    if (!secretResponse.SecretString) {
      throw new Error(`Secret ${secretName} not found`);
    }

    if (secretType === "json") {
      return JSON.parse(secretResponse.SecretString) as T;
    } else if (secretType === "string") {
      return secretResponse.SecretString;
    } else {
      throw new Error(`Unsupported secret type: ${secretType}`);
    }
  } catch (error: any) {
    console.error(`Error retrieving secret ${secretName}:`, error);
    throw new Error(
      `Failed to retrieve secret ${secretName}: ${error.message}`
    );
  }
}

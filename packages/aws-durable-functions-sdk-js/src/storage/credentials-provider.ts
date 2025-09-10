import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { AwsCredentialIdentityProvider } from "@smithy/types";

function fromTestCredentials(): AwsCredentialIdentityProvider {
  return async () => {
    return {
      accessKeyId: "placeholder-accessKeyId",
      secretAccessKey: "placeholder-secretAccessKey",
      sessionToken: "placeholder-sessionToken",
    };
  };
}

export function getCredentialsProvider(): AwsCredentialIdentityProvider {
  const isLocalMode = process.env.DURABLE_LOCAL_MODE === "true";

  if (isLocalMode) {
    return fromTestCredentials();
  }

  return defaultProvider();
}

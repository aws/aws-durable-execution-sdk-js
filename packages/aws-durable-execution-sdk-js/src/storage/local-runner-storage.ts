import { LambdaClient } from "@aws-sdk/client-lambda";
import { Sha256 } from "@aws-crypto/sha256-js";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { SignatureV4 } from "@smithy/signature-v4";
import {
  AwsCredentialIdentity,
  HttpHandlerOptions,
  HttpRequest,
  HttpResponse,
  Provider,
} from "@smithy/types";
import { ApiStorage } from "./api-storage";
import { defaultProvider } from "@aws-sdk/credential-provider-node";

class LocalRunnerSigV4Handler extends NodeHttpHandler {
  private readonly httpHandler: NodeHttpHandler;
  private readonly signer: SignatureV4;

  public constructor(
    handler: NodeHttpHandler,
    credentials: Provider<AwsCredentialIdentity> | AwsCredentialIdentity
  ) {
    super();
    this.httpHandler = handler;
    this.signer = new SignatureV4({
      credentials: credentials,
      region: "us-west-2",
      service: "execute-api",
      sha256: Sha256,
    });
  }

  public async handle(
    request: HttpRequest,
    _handlerOptions?: HttpHandlerOptions | undefined
  ): Promise<{ response: HttpResponse }> {
    const signedRequest: HttpRequest = await this.signer.sign(request);
    // @ts-expect-error - The handle method signature doesn't match exactly but works correctly
    return this.httpHandler.handle(signedRequest);
  }
}

export class LocalRunnerStorage extends ApiStorage {
  constructor() {
    const endpoint = process.env.DURABLE_LOCAL_RUNNER_ENDPOINT;
    const region = process.env.DURABLE_LOCAL_RUNNER_REGION;
    const localRunnerCredentials = process.env.DURABLE_LOCAL_RUNNER_CREDENTIALS
      ? JSON.parse(process.env.DURABLE_LOCAL_RUNNER_CREDENTIALS)
      : defaultProvider();

    const client = new LambdaClient({
      credentials: localRunnerCredentials,
      endpoint,
      region,
      requestHandler: new LocalRunnerSigV4Handler(
        new NodeHttpHandler(),
        localRunnerCredentials
      ),
    });

    // Pass the pre-configured client to the parent constructor
    super(client);
  }
}

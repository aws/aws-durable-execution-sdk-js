import { LambdaClient } from "@aws-sdk/client-lambda";
import { Sha256 } from "@aws-crypto/sha256-js";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { SignatureV4 } from "@smithy/signature-v4";
import {
  AwsCredentialIdentity,
  HttpHandlerOptions,
  HttpRequest,
  HttpResponse,
} from "@smithy/types";
import { ApiStorage } from "./api-storage";

class LocalRunnerSigV4Handler extends NodeHttpHandler {
  private readonly httpHandler: NodeHttpHandler;
  private readonly signer: SignatureV4;

  public constructor(
    handler: NodeHttpHandler,
    credentials: AwsCredentialIdentity,
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
    _handlerOptions?: HttpHandlerOptions | undefined,
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

    const credentials = {
      accessKeyId: "placeholder-accessKeyId",
      secretAccessKey: "placeholder-secretAccessKey",
      sessionToken: "placeholder-sessionToken",
    };
    const client = new LambdaClient({
      endpoint,
      region,
      credentials: credentials,
      requestHandler: new LocalRunnerSigV4Handler(
        new NodeHttpHandler(),
        credentials,
      ),
    });

    // Pass the pre-configured client to the parent constructor
    super(client);
  }
}

import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageBatchCommand,
} from "@aws-sdk/client-sqs";
import type { AwsCredentialIdentityProvider } from "@aws-sdk/types";

export interface SqsMessageRow {
  messageId: string;
  receivedAt: string;
  body: string;
  attributes: Record<string, string>;
}

const LONG_POLL_WAIT_SECONDS = 20;
const MAX_MESSAGES_PER_POLL = 10;

/**
 * Long-polls an SQS queue indefinitely, invoking `onMessages` with each batch
 * as it arrives, until `signal` is aborted.
 *
 * Peek-only by default (`deleteAfterRead: false`): messages are left on the
 * queue so other consumers still receive every message — the Explorer is just
 * observing. Because messages aren't deleted, the SAME message will be
 * re-delivered on a later poll once its visibility timeout elapses; callers
 * should de-duplicate by `messageId` when rendering.
 *
 * When `deleteAfterRead` is true, the Explorer becomes a real consumer:
 * messages are deleted immediately after being handed to `onMessages`, so no
 * other consumer will see them and no re-delivery will occur.
 */
export async function listenToQueue(opts: {
  region: string;
  credentials: AwsCredentialIdentityProvider;
  queueUrl: string;
  deleteAfterRead: boolean;
  signal: AbortSignal;
  onMessages: (messages: SqsMessageRow[]) => void;
  onError: (error: Error) => void;
}): Promise<void> {
  const client = new SQSClient({
    region: opts.region,
    credentials: opts.credentials,
  });

  try {
    while (!opts.signal.aborted) {
      // biome-ignore lint/suspicious/noImplicitAnyLet: pre-existing finding surfaced by the ESLint-to-Biome migration; not triaged as part of the toolchain change
      let result;
      try {
        result = await client.send(
          new ReceiveMessageCommand({
            QueueUrl: opts.queueUrl,
            MaxNumberOfMessages: MAX_MESSAGES_PER_POLL,
            WaitTimeSeconds: LONG_POLL_WAIT_SECONDS,
            MessageAttributeNames: ["All"],
            AttributeNames: ["All"],
          }),
          { abortSignal: opts.signal },
        );
      } catch (err) {
        if (opts.signal.aborted) return; // aborted mid-request; stop quietly
        opts.onError(err instanceof Error ? err : new Error(String(err)));
        continue;
      }

      const messages = result.Messages ?? [];
      if (messages.length > 0) {
        const receivedAt = new Date().toISOString();
        opts.onMessages(
          messages.map((m) => ({
            messageId: m.MessageId ?? "",
            receivedAt,
            body: m.Body ?? "",
            attributes: Object.fromEntries(
              Object.entries(m.MessageAttributes ?? {}).map(([k, v]) => [
                k,
                v.StringValue ?? "",
              ]),
            ),
          })),
        );

        if (opts.deleteAfterRead) {
          const entries = messages
            .filter((m) => m.MessageId && m.ReceiptHandle)
            .map((m) => ({
              Id: m.MessageId!,
              ReceiptHandle: m.ReceiptHandle!,
            }));
          if (entries.length > 0) {
            try {
              await client.send(
                new DeleteMessageBatchCommand({
                  QueueUrl: opts.queueUrl,
                  Entries: entries,
                }),
              );
            } catch (err) {
              // Non-fatal: message was already shown to the user; failing to
              // delete just means it may be re-delivered later. Keep listening.
              opts.onError(err instanceof Error ? err : new Error(String(err)));
            }
          }
        }
      }
    }
  } finally {
    client.destroy();
  }
}

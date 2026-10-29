/** Stands in for ./hostBridge in `*.hook.test.ts`: records outbound messages. */
export const sent: { type: string; [k: string]: unknown }[] = [];

export function postMessage(msg: { type: string }): void {
  sent.push(msg as { type: string });
}

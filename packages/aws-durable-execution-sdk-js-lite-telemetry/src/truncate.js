const bytes = (value) => Buffer.byteLength(JSON.stringify(value));

// Returns the record, or a smaller copy that fits maxBytes, or undefined when nothing
// fits. The plugin shares one record between all exporters. So this function never
// changes the record it receives.
//
// The drop order:
// 1. input, then output. Each sets its dropped flag.
// 2. operations from the end, the newest first. droppedOperations counts them.
// Any drop sets truncated: true.
export function fitRecord(record, maxBytes) {
  if (maxBytes === undefined || bytes(record) <= maxBytes) return record;
  const out = { ...record, truncated: true };
  let size = bytes(out);
  if (size > maxBytes && out.input !== undefined) {
    out.input = undefined;
    out.droppedInput = true;
    size = bytes(out);
  }
  if (size > maxBytes && out.output !== undefined) {
    out.output = undefined;
    out.droppedOutput = true;
    size = bytes(out);
  }
  const operations = [...out.operations];
  out.operations = operations;
  // A full JSON.stringify per dropped operation would cost quadratic time for a large
  // record. So the loop subtracts the size of each dropped operation and its comma. The
  // estimate ignores the droppedOperations field. So the loop measures the whole record
  // again each time the estimate fits.
  while (size > maxBytes && operations.length > 0) {
    size -= bytes(operations.pop()) + 1;
    out.droppedOperations = (out.droppedOperations ?? 0) + 1;
    if (size <= maxBytes) size = bytes(out);
  }
  return bytes(out) <= maxBytes ? out : undefined;
}

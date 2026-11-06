import type { OperationsFormat } from "./types";

/** Marks SDK-owned renderers whose operation shape can be sized by deltas. */
export const TRUNCATION_OPERATIONS_FORMAT: unique symbol = Symbol(
  "truncationOperationsFormat",
);

export type TruncationOperationsFormat = OperationsFormat | "by-name";

export interface TruncationFormatProvider {
  readonly [TRUNCATION_OPERATIONS_FORMAT]?: TruncationOperationsFormat;
}

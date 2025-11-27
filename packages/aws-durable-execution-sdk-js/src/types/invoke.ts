import { Serdes } from "../utils/serdes/serdes";

/**
 * Configuration options for invoke operations
 * @public
 */
export interface InvokeConfig<I, O> {
  /** Serialization/deserialization configuration for input payload */
  payloadSerdes?: Serdes<I>;
  /** Serialization/deserialization configuration for result data */
  resultSerdes?: Serdes<O>;
}

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
  /** Tenant identifier for invoking tenant-isolated Lambda functions */
  tenantId?: string;
  /**
   * Base64-encoded data about the invoking client to pass to the invoked
   * function in its context object. Up to 3,583 bytes. Delivered to the
   * invoked function's context object.
   */
  clientContext?: string;
}

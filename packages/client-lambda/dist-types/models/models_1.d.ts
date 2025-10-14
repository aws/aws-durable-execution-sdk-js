import { ErrorObject } from "./models_0";
/**
 * @public
 */
export interface SendDurableExecutionCallbackFailureRequest {
  CallbackId: string | undefined;
  Error?: ErrorObject | undefined;
}
/**
 * @public
 */
export interface SendDurableExecutionCallbackFailureResponse {}
/**
 * @public
 */
export interface SendDurableExecutionCallbackHeartbeatRequest {
  CallbackId: string | undefined;
}
/**
 * @public
 */
export interface SendDurableExecutionCallbackHeartbeatResponse {}
/**
 * @public
 */
export interface SendDurableExecutionCallbackSuccessRequest {
  CallbackId: string | undefined;
  Result?: Uint8Array | undefined;
}
/**
 * @public
 */
export interface SendDurableExecutionCallbackSuccessResponse {}
/**
 * @public
 */
export interface StopDurableExecutionRequest {
  DurableExecutionArn: string | undefined;
  Error?: ErrorObject | undefined;
}
/**
 * @public
 */
export interface StopDurableExecutionResponse {
  StopTimestamp: Date | undefined;
}
/**
 * @public
 */
export interface TagResourceRequest {
  /**
   * <p>The resource's Amazon Resource Name (ARN).</p>
   * @public
   */
  Resource: string | undefined;
  /**
   * <p>A list of tags to apply to the resource.</p>
   * @public
   */
  Tags: Record<string, string> | undefined;
}
/**
 * @public
 */
export interface UntagResourceRequest {
  /**
   * <p>The resource's Amazon Resource Name (ARN).</p>
   * @public
   */
  Resource: string | undefined;
  /**
   * <p>A list of tag keys to remove from the resource.</p>
   * @public
   */
  TagKeys: string[] | undefined;
}
/**
 * @internal
 */
export declare const SendDurableExecutionCallbackFailureRequestFilterSensitiveLog: (
  obj: SendDurableExecutionCallbackFailureRequest,
) => any;
/**
 * @internal
 */
export declare const SendDurableExecutionCallbackSuccessRequestFilterSensitiveLog: (
  obj: SendDurableExecutionCallbackSuccessRequest,
) => any;
/**
 * @internal
 */
export declare const StopDurableExecutionRequestFilterSensitiveLog: (
  obj: StopDurableExecutionRequest,
) => any;

import { ErrorObject, ExecutionStatus } from "@aws-sdk/client-lambda";
import {
  DurableExecutionInvocationInput,
  LambdaHandler,
} from "aws-durable-execution-sdk-js";
import { Handler } from "aws-lambda";
import { InvokeHandler } from "../invoke-handler";
import { ILocalDurableTestRunnerFactory } from "../interfaces/durable-test-runner-factory";

/**
 * Configuration for a durable function handler.
 */
interface DurableHandlerData {
  isDurable: true;
  handler: LambdaHandler<DurableExecutionInvocationInput>;
}

/**
 * Configuration for a non-durable Lambda function handler.
 */
interface NonDurableHandlerData {
  isDurable: false;
  handler: Handler;
}

/**
 * Union type representing either a durable or non-durable handler configuration.
 */
export type HandlerData = DurableHandlerData | NonDurableHandlerData;

/**
 * Map of function names to their handler configurations.
 * Used to register functions that can be invoked during durable execution testing.
 */
export type FunctionNameMap = Record<string, HandlerData>;

/**
 * Internal storage for registered function handlers used during durable execution testing.
 * Manages both durable and non-durable function execution within the test environment.
 */
export class FunctionStorage {
  /**
   * Internal storage map of registered function names to their handler configurations.
   * @private
   */
  private functionNameMap: FunctionNameMap = {};

  /**
   * @param runnerFactory Factory for creating durable test runner instances
   */
  constructor(private readonly runnerFactory: ILocalDurableTestRunnerFactory) {}

  /**
   * Registers a durable function handler that can be invoked during test execution.
   * Durable functions are executed with their own LocalDurableTestRunner instance.
   *
   * @param functionName - The name/ARN of the function to register
   * @param durableHandler - The durable function handler created with withDurableFunctions
   */
  registerDurableFunction(
    functionName: string,
    durableHandler: LambdaHandler<DurableExecutionInvocationInput>
  ) {
    this.functionNameMap[functionName] = {
      isDurable: true,
      handler: durableHandler,
    };
  }

  /**
   * Registers a standard Lambda function handler that can be invoked during test execution.
   * Non-durable functions are executed directly without durable execution capabilities.
   *
   * @param functionName - The name/ARN of the function to register
   * @param handler - The standard Lambda function handler
   */
  registerFunction(functionName: string, handler: Handler): void {
    this.functionNameMap[functionName] = {
      isDurable: false,
      handler,
    };
  }

  /**
   * Executes a registered function handler by name with the provided payload.
   * Handles both durable and non-durable function execution with appropriate context.
   *
   * @param functionName - Name of the function to execute
   * @param payload - JSON string payload to pass to the function
   * @param skipTime - Whether to skip time delays for durable functions
   * @returns Promise resolving to execution result or error information
   * @throws Error if the function name is not registered
   */
  async runHandler(
    functionName: string,
    payload: string | undefined,
    skipTime: boolean
  ): Promise<{
    result?: string;
    error?: ErrorObject;
  }> {
    const functionData = this.functionNameMap[functionName];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!functionData) {
      throw new Error(
        `No function found for function name ${functionName}.\n` +
          `Please configure the function handler for "${functionName}" with LocalDurableTestRunner.registerFunctions.`
      );
    }

    const { isDurable, handler } = functionData;

    if (isDurable) {
      const invokeRunner = this.runnerFactory.createRunner({
        handlerFunction: handler,
        skipTime,
      });

      const execution = await invokeRunner.run({
        payload: payload ? JSON.parse(payload) : undefined,
      });

      const status = execution.getStatus();

      if (status === ExecutionStatus.RUNNING) {
        throw new Error(
          `Invalid execution status for completed handler: ${status}`
        );
      }

      const resultString =
        status === ExecutionStatus.SUCCEEDED
          ? JSON.stringify(execution.getResult())
          : undefined;

      const error =
        status !== ExecutionStatus.SUCCEEDED ? execution.getError() : undefined;

      return {
        result: resultString,
        error: error
          ? {
              ErrorData: error.errorData,
              ErrorMessage: error.errorMessage,
              ErrorType: error.errorType,
              StackTrace: error.stackTrace,
            }
          : undefined,
      };
    }

    try {
      const result = await new Promise((resolve, reject) => {
        const result = handler(
          JSON.parse(payload ?? "{}"),
          // TODO: pass the correct context values to the child handler
          new InvokeHandler().buildContext(),
          (error, result) => {
            if (error) {
              reject(error instanceof Error ? error : new Error(error));
            } else {
              resolve(result);
            }
          }
        );
        if (result instanceof Promise) {
          result.then(resolve).catch(reject);
        }
      });
      return {
        result: JSON.stringify(result),
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        return {
          error: {
            ErrorMessage: err.message,
            ErrorType: err.name,
            StackTrace: err.stack?.split("\n"),
          },
        };
      }

      return {
        error: {
          ErrorMessage: String(err),
        },
      };
    }
  }
}

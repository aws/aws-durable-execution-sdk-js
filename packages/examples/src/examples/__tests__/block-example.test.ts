import {
  LocalDurableTestRunner,
  OperationType,
} from "@amzn/durable-executions-type-script-testing-library";
import { handler } from "../block-example";

beforeAll(() => LocalDurableTestRunner.setupTestEnvironment());
afterAll(() => LocalDurableTestRunner.teardownTestEnvironment());

describe("block-example test", () => {
  const durableTestRunner = new LocalDurableTestRunner({
    handlerFunction: handler,
    skipTime: true,
  });

  it("should execute nested child contexts with proper checkpointing", async () => {
    const execution = await durableTestRunner.run();

    // Verify the final result structure
    const result = execution.getResult();
    expect(result).toEqual({
      nestedStep: "nested step result",
      nestedBlock: "nested block result",
    });

    // Check for the parent block operation
    const parentBlockOp = durableTestRunner.getOperation("parent_block");
    expect(parentBlockOp.getContextDetails()?.result).toEqual({
      nestedStep: "nested step result",
      nestedBlock: "nested block result",
    });

    const childOperations = parentBlockOp.getChildOperations()
    expect(childOperations).toHaveLength(2)
    expect(childOperations![0].getStepDetails()?.result).toEqual("nested step result");
    expect(childOperations![1].getContextDetails()?.result).toEqual("nested block result");

    // Check for nested step operation
    const nestedStepOp = durableTestRunner.getOperation("nested_step");
    expect(nestedStepOp.getStepDetails()?.result).toEqual("nested step result");

    // Check for nested block operation
    const nestedBlockOp = durableTestRunner.getOperation("nested_block");
    expect(nestedBlockOp.getContextDetails()?.result).toEqual(
      "nested block result"
    );
  });

  it("should execute wait operation within nested context", async () => {
    const execution = await durableTestRunner.run();

    // Verify execution completed successfully
    expect(execution.getResult()).toBeDefined();

    const completedOperations = execution.getOperations();
    const waitOp = completedOperations.find(
      (op) =>
        op.getType() === OperationType.WAIT &&
        op.getWaitDetails()?.waitSeconds === 1
    );
    expect(waitOp).toBeDefined();
  });
});

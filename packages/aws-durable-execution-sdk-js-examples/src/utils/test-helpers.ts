import {
  OperationStatus,
  TestRunner,
} from "@aws/durable-execution-sdk-js-testing";

export function verifyOperationStatuses(
  runner: TestRunner,
  expectations: Array<{ name: string; status: OperationStatus }>,
) {
  expectations.forEach(({ name, status }) => {
    const operation = runner.getOperation(name);
    expect(operation?.getStatus()).toBe(status);
  });
}

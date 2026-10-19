/**
 * `runDynamoDBQuery` must report whether the single page it fetched was the whole
 * answer.
 *
 * THE FAILURE THIS PREVENTS:
 * This runner issues ONE `ExecuteStatement` and does not paginate. DynamoDB bounds a
 * response at ~1 MB regardless of how many items match, and signals that more exist
 * by returning a `NextToken`. That token was discarded and absent from
 * `DynamoDBQueryResult`, so a caller had no way to tell a complete result of 400
 * rows from the first 400 of 5,000 -- and the MCP host's `truncated` flag,
 * necessarily derived from the row count alone, reported the second as the first.
 *
 * The MCP host's own tests cannot catch a regression here: they mock this runner, so
 * a version that stops reading `NextToken` still satisfies them. This is the test
 * that pins the behavior to the SDK response.
 */
const mockSend = jest.fn();

jest.mock("@aws-sdk/client-dynamodb", () => ({
  DynamoDBClient: jest.fn(() => ({ send: mockSend })),
  ExecuteStatementCommand: jest.fn((i) => ({ __type: "execute", i })),
}));

import { runDynamoDBQuery } from "./dynamodb";

const OPTS = {
  region: "us-east-1",
  credentials: (() => Promise.resolve({})) as never,
  tableName: "T",
  statement: "SELECT * FROM T",
};

/** One marshalled item, as ExecuteStatement returns them. */
const item = (n: number) => ({ n: { N: String(n) } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("runDynamoDBQuery reports response completeness", () => {
  it("sets hasMore when the response carries a NextToken", async () => {
    mockSend.mockResolvedValueOnce({
      Items: [item(1), item(2)],
      NextToken: "opaque-token",
    });
    const result = await runDynamoDBQuery(OPTS);
    expect(result.hasMore).toBe(true);
    // The rows it DID return are still returned in full.
    expect(result.count).toBe(2);
  });

  it("leaves hasMore false when there is no NextToken", async () => {
    // Acceptance matters as much: a runner that always reported hasMore would pass
    // the case above while making every complete result look truncated.
    mockSend.mockResolvedValueOnce({ Items: [item(1), item(2)] });
    const result = await runDynamoDBQuery(OPTS);
    expect(result.hasMore).toBe(false);
    expect(result.count).toBe(2);
  });

  it("sets hasMore on an empty page that still has a NextToken", async () => {
    // DynamoDB can return zero items with a token when a scan segment matched
    // nothing; the early return for an empty page must not lose the signal, or
    // "no results" would be indistinguishable from "none in the first megabyte".
    mockSend.mockResolvedValueOnce({ Items: [], NextToken: "opaque-token" });
    const result = await runDynamoDBQuery(OPTS);
    expect(result.count).toBe(0);
    expect(result.hasMore).toBe(true);
  });

  it("leaves hasMore false on a genuinely empty result", async () => {
    mockSend.mockResolvedValueOnce({ Items: [] });
    const result = await runDynamoDBQuery(OPTS);
    expect(result.count).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it("issues exactly one ExecuteStatement, even when more results exist", async () => {
    // Pins the non-paginating contract the `hasMore` flag exists to describe. If
    // this runner ever starts paginating, `hasMore` changes meaning and every
    // caller deriving truncation from it needs revisiting -- so that change should
    // break a test rather than pass quietly.
    mockSend.mockResolvedValueOnce({ Items: [item(1)], NextToken: "more" });
    await runDynamoDBQuery(OPTS);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

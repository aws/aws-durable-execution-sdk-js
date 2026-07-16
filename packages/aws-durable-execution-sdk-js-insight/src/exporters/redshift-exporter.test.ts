const mockSend = jest.fn();

jest.mock("@aws-sdk/client-redshift-data", () => ({
  RedshiftDataClient: jest.fn(() => ({ send: mockSend })),
  ExecuteStatementCommand: jest.fn((input: unknown) => ({ __input: input })),
}));

import { RedshiftExporter } from "./redshift-exporter";
import { makeRecord } from "../test-utils/make-record";

function paramMap(
  params: { name: string; value: unknown }[],
): Record<string, unknown> {
  return Object.fromEntries(params.map((p) => [p.name, p.value]));
}

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({});
});

describe("RedshiftExporter", () => {
  it("upserts via a MERGE that joins on a source-column subquery with typed casts", async () => {
    const exporter = new RedshiftExporter({
      workgroupName: "insight-wg",
      database: "insight",
      region: "us-east-1",
    });

    await exporter.export(makeRecord());

    expect(mockSend).toHaveBeenCalledTimes(1);
    const input = mockSend.mock.calls[0][0].__input;
    expect(input.WorkgroupName).toBe("insight-wg");
    expect(input.Database).toBe("insight");

    const sql = input.Sql;
    expect(sql).toContain("MERGE INTO public.workflow_insight");
    // Joins on the projected source column, NOT a bound parameter/constant.
    expect(sql).toContain("src.execution_arn");
    expect(sql).toContain(
      "ON public.workflow_insight.execution_arn = src.execution_arn",
    );
    expect(sql).not.toContain("USING (SELECT 1)");
    // Time fields cast to timestamptz; SUPER column via JSON_PARSE.
    expect(sql).toContain(":start_time::timestamptz");
    expect(sql).toContain(":emitted_at::timestamptz");
    expect(sql).toContain("JSON_PARSE(:record_json)");

    const params = paramMap(input.Parameters);
    expect(params.execution_arn).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:fn:$LATEST",
    );
    expect(params.end_time).toBe("2026-07-15T12:00:00.000Z");
  });

  it("emits typed NULL literals (not bound params) for absent nullable fields", async () => {
    const exporter = new RedshiftExporter({
      clusterIdentifier: "insight-cluster",
      database: "insight",
      dbUser: "admin",
    });

    await exporter.export(
      makeRecord({
        endTime: undefined,
        durationMs: undefined,
        executionName: undefined,
      }),
    );

    const input = mockSend.mock.calls[0][0].__input;
    expect(input.ClusterIdentifier).toBe("insight-cluster");
    expect(input.Sql).toContain("NULL::timestamptz AS end_time");
    expect(input.Sql).toContain("NULL::bigint AS duration_ms");
    expect(input.Sql).toContain("NULL::varchar AS execution_name");

    const params = paramMap(input.Parameters);
    expect(params.end_time).toBeUndefined();
    expect(params.duration_ms).toBeUndefined();
    expect(params.execution_name).toBeUndefined();
  });

  it("throws when neither workgroupName nor clusterIdentifier is provided", () => {
    expect(() => new RedshiftExporter({ database: "insight" })).toThrow(
      /workgroupName or clusterIdentifier/,
    );
  });
});

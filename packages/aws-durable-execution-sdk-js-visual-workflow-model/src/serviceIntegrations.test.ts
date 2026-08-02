import {
  SERVICE_INTEGRATIONS,
  SERVICE_INTEGRATION_LIST,
  getServiceIntegration,
} from "./serviceIntegrations";

describe("service integration registry", () => {
  it("keys match the map entries", () => {
    for (const [key, preset] of Object.entries(SERVICE_INTEGRATIONS)) {
      expect(preset.key).toBe(key);
    }
  });

  it("every preset is well-formed", () => {
    for (const p of SERVICE_INTEGRATION_LIST) {
      expect(p.key).toMatch(/^[a-z][\w-]*\.[A-Za-z]\w*$/);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.shortLabel.length).toBeGreaterThan(0);
      expect(p.clientPackage).toBe(`@aws-sdk/client-${p.service}`);
      expect(p.clientClass).toMatch(/Client$/);
      expect(p.start.command).toMatch(/Command$/);
      expect(p.poll.command).toMatch(/Command$/);
      expect(p.start.idPath.length).toBeGreaterThan(0);
      // Poll input references either the extracted job id or a name from the
      // start input (e.g. SageMaker polls by *JobName from startInput).
      expect(p.poll.inputExpr).toMatch(/jobId|startInput/);
      expect(p.poll.statusPath.length).toBeGreaterThan(0);
      expect(p.success.length).toBeGreaterThan(0);
      // Some services (e.g. ECS) have no distinct failure status — a task just
      // reaches STOPPED — so `failure` may be empty, but must not overlap
      // `success`.
      for (const s of p.success) expect(p.failure).not.toContain(s);
      expect(p.defaultPollSeconds).toBeGreaterThan(0);
      expect(p.maxWaitSeconds).toBeGreaterThan(0);
      expect(p.iamActions.length).toBeGreaterThan(0);
      // Every IAM action is a well-formed `service:Action` (the IAM service
      // prefix may differ from the client package name, e.g. sfn -> states).
      for (const a of p.iamActions) {
        expect(a).toMatch(/^[a-z0-9-]+:[A-Za-z]\w*$/);
      }
    }
  });

  it("looks up by key and tolerates undefined", () => {
    expect(getServiceIntegration("glue.startJobRun")?.service).toBe("glue");
    expect(getServiceIntegration(undefined)).toBeUndefined();
    expect(getServiceIntegration("nope")).toBeUndefined();
  });
});

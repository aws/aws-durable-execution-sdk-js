import { ensureImage, type ImageService } from "../ensure-microvm-image";

type State = string | undefined;

/**
 * A scripted image service. get() returns the states in `queue` one per
 * call, and repeats the last one. create() and delete() replace the queue
 * with the states that the scenario gives for that call. `undefined` stands
 * for a missing image.
 */
class FakeImageService implements ImageService {
  creates = 0;
  deletes = 0;
  gets = 0;

  constructor(
    private queue: State[],
    private readonly afterCreate: (create: number) => State[] = () => [
      "CREATING",
      "CREATED",
    ],
    private readonly afterDelete: () => State[] = () => ["DELETING", undefined],
  ) {}

  async get() {
    this.gets++;
    const state = this.queue.length > 1 ? this.queue.shift() : this.queue[0];
    if (state === undefined) {
      return undefined;
    }
    return {
      state,
      latestActiveImageVersion:
        state === "CREATED" || state === "UPDATED" ? "1.0" : undefined,
    };
  }

  async create() {
    this.creates++;
    this.queue = this.afterCreate(this.creates);
  }

  async delete() {
    this.deletes++;
    this.queue = this.afterDelete();
  }
}

function run(service: FakeImageService) {
  let time = 0;
  const messages: string[] = [];
  const promise = ensureImage(service, {
    name: "sdk-js-examples-test",
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    log: (message) => messages.push(message),
  });
  return { promise, messages, elapsed: () => time };
}

describe("ensureImage", () => {
  it("reuses an image that is ready", async () => {
    const service = new FakeImageService(["CREATED"]);
    const { promise, messages } = run(service);

    await expect(promise).resolves.toBe("1.0");
    expect(service.creates).toBe(0);
    expect(messages[0]).toMatch(/^Reusing/);
  });

  it("creates a missing image and waits for it", async () => {
    const service = new FakeImageService([undefined]);
    const { promise } = run(service);

    await expect(promise).resolves.toBe("1.0");
    expect(service.creates).toBe(1);
  });

  it("creates the image after a delete in progress finishes", async () => {
    const service = new FakeImageService([
      "DELETING",
      "DELETING",
      "DELETING",
      undefined,
    ]);
    const { promise, messages } = run(service);

    await expect(promise).resolves.toBe("1.0");
    expect(service.creates).toBe(1);
    expect(messages.some((message) => message.startsWith("Reusing"))).toBe(
      false,
    );
  });

  it("treats a DELETED record as a missing image", async () => {
    const service = new FakeImageService(["DELETED"]);
    const { promise } = run(service);

    await expect(promise).resolves.toBe("1.0");
    expect(service.creates).toBe(1);
  });

  it("deletes a failed image from an earlier run and builds it again", async () => {
    const service = new FakeImageService(["CREATE_FAILED"]);
    const { promise } = run(service);

    await expect(promise).resolves.toBe("1.0");
    expect(service.deletes).toBe(1);
    expect(service.creates).toBe(1);
  });

  it("rebuilds a failed build once, then throws with the log group", async () => {
    const service = new FakeImageService([undefined], () => [
      "CREATING",
      "CREATE_FAILED",
    ]);
    const { promise } = run(service);

    await expect(promise).rejects.toThrow(
      "/aws/lambda-microvms/sdk-js-examples-test",
    );
    expect(service.creates).toBe(2);
    expect(service.deletes).toBe(1);
  });

  it("waits while a deleted failed image is still reported", async () => {
    const service = new FakeImageService(["CREATE_FAILED"], undefined, () => [
      "CREATE_FAILED",
      "DELETING",
      undefined,
    ]);
    const { promise } = run(service);

    await expect(promise).resolves.toBe("1.0");
    expect(service.deletes).toBe(1);
    expect(service.creates).toBe(1);
  });

  it("throws on DELETE_FAILED without a delete or a create", async () => {
    const service = new FakeImageService(["DELETE_FAILED"]);
    const { promise } = run(service);

    await expect(promise).rejects.toThrow(/is DELETE_FAILED/);
    expect(service.creates).toBe(0);
    expect(service.deletes).toBe(0);
  });

  it("does not create again while a new image is not visible yet", async () => {
    const service = new FakeImageService([undefined], () => [
      undefined,
      undefined,
      "CREATING",
      "CREATED",
    ]);
    const { promise } = run(service);

    await expect(promise).resolves.toBe("1.0");
    expect(service.creates).toBe(1);
  });

  it("throws when the image stays missing after two creates", async () => {
    const service = new FakeImageService([undefined], () => [undefined]);
    const { promise } = run(service);

    await expect(promise).rejects.toThrow(/after 2 CreateMicrovmImage calls/);
    expect(service.creates).toBe(2);
  });

  it("throws when the build does not finish in time", async () => {
    const service = new FakeImageService(["CREATING"]);
    const { promise, elapsed } = run(service);

    await expect(promise).rejects.toThrow(/still CREATING after 20 minutes/);
    expect(elapsed()).toBeGreaterThan(20 * 60_000);
  });
});

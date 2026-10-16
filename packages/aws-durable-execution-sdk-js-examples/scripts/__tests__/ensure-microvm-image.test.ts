import {
  ResourceNotFoundException,
  ValidationException,
} from "@aws-sdk/client-lambda-microvms";
import {
  createImageService,
  ensureImage,
  type ImageService,
} from "../ensure-microvm-image";

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

describe("createImageService", () => {
  type Handler = (command: string) => unknown;

  /** A client whose send() runs `handler` with the command's class name. */
  function fakeClient(handler: Handler) {
    const commands: string[] = [];
    return {
      commands,
      send: jest.fn(async (command: object) => {
        const name = command.constructor.name;
        commands.push(name);
        return handler(name);
      }),
    };
  }

  function service(microvmsHandler: Handler, s3Handler: Handler = () => ({})) {
    const microvms = fakeClient(microvmsHandler);
    const s3 = fakeClient(s3Handler);
    const imageService = createImageService({
      microvms: microvms as never,
      s3: s3 as never,
      name: "sdk-js-examples-test",
      imageArn:
        "arn:aws:lambda:us-east-1:123456789012:microvm-image:sdk-js-examples-test",
      bucket: "test-bucket",
      key: "examples/sdk-js-examples-test.zip",
      zip: Buffer.from("zip"),
      settings: {
        baseImageArn: "arn:aws:lambda:us-east-1:aws:microvm-image:al2023-1",
        buildRoleArn: "arn:aws:iam::123456789012:role/microvm-image-build",
        egressNetworkConnectors: [],
        hooks: {},
      },
    });
    return { imageService, microvms, s3 };
  }

  const notFound = () =>
    new ResourceNotFoundException({ message: "not found", $metadata: {} });

  beforeEach(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("carries on when another run deleted the image first", async () => {
    const { imageService, microvms } = service(() => {
      throw notFound();
    });

    await expect(imageService.delete()).resolves.toBeUndefined();
    expect(microvms.commands).toEqual([
      "DeleteMicrovmImageCommand",
      "GetMicrovmImageCommand",
    ]);
  });

  it("carries on when another run is deleting the image", async () => {
    const { imageService } = service((command) => {
      if (command === "DeleteMicrovmImageCommand") {
        throw new Error("delete in progress");
      }
      return { state: "DELETING" };
    });

    await expect(imageService.delete()).resolves.toBeUndefined();
  });

  it("rethrows a delete error when the failed image is still there", async () => {
    const { imageService } = service((command) => {
      if (command === "DeleteMicrovmImageCommand") {
        throw new Error("access denied");
      }
      return { state: "CREATE_FAILED" };
    });

    await expect(imageService.delete()).rejects.toThrow("access denied");
  });

  it("treats a duplicate name as a build by another run", async () => {
    const { imageService } = service((command) => {
      if (command === "CreateMicrovmImageCommand") {
        throw new ValidationException({
          message:
            "A MicroVM image with the name 'sdk-js-examples-test' already exists in this account",
          $metadata: {},
        });
      }
      throw notFound();
    });

    await expect(imageService.create()).resolves.toBeUndefined();
  });

  it("rethrows a create error when no image exists", async () => {
    const { imageService } = service((command) => {
      if (command === "CreateMicrovmImageCommand") {
        throw new Error("quota exceeded");
      }
      throw notFound();
    });

    await expect(imageService.create()).rejects.toThrow("quota exceeded");
  });

  it("names the override variables when the bucket is missing", async () => {
    const { imageService, microvms } = service(
      () => ({}),
      () => {
        throw Object.assign(new Error("missing"), { name: "NoSuchBucket" });
      },
    );

    await expect(imageService.create()).rejects.toThrow(
      /test-bucket does not exist.*MICROVM_ARTIFACT_BUCKET/,
    );
    expect(microvms.commands).toEqual([]);
  });
});

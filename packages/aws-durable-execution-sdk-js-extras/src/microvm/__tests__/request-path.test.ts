// The worker matches the raw request path. These tests send each kind of
// path that validateRequest accepts with the real fetch to a local server, and
// check that the server receives the path as written.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { sendJob } from "../request";
import { FakeMicrovmsClient } from "./fakes";

describe("the request path on the wire", () => {
  let server: Server;
  let base: string;
  const received: string[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      received.push(request.url ?? "");
      request.resume();
      request.on("end", () => response.writeHead(202).end());
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([
    "/",
    "/clone-build",
    "/clone%20build",
    "/%e2%9c%93/%E2%9C%93",
    "/a:b@c",
    "/!$&'()*+,;=",
    "/~user/-._",
    "//double//slash/",
    // Dots next to other characters, and three dots, are not dot segments.
    "/.well-known/job",
    "/.../job",
    "/a.b/c..d",
  ])("sends %s as written", async (path) => {
    received.length = 0;

    await sendJob({
      client: new FakeMicrovmsClient().asClient(),
      fetch,
      microvmId: "mvm-1",
      endpoint: base,
      path,
      port: 8080,
      body: "{}",
      retryWindowMs: 5_000,
      log: jest.fn(),
    });

    expect(received).toEqual([path]);
  });
});

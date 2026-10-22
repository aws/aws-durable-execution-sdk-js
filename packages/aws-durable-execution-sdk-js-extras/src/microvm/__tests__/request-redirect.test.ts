// The request step does not follow redirects. A followed 301, 302, or 303
// turns the POST into a GET without the job, and a 2xx for that GET counted
// as accepted, so the job never started. A followed redirect to another host
// also received the auth token. So a redirect fails the delivery at once.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { MicrovmRequestRejectedError, sendJob } from "../request";
import { FakeEndpoint, FakeMicrovmsClient } from "./fakes";

const send = (fetchImpl: typeof fetch, endpoint: string, path: string) =>
  sendJob({
    client: new FakeMicrovmsClient().asClient(),
    fetch: fetchImpl,
    microvmId: "mvm-1",
    endpoint,
    path,
    port: 8080,
    body: "{}",
    retryWindowMs: 5_000,
    log: jest.fn(),
  });

const rejection = (path: string, status: number, location?: string): string =>
  `The MicroVM answered the job at ${path} with HTTP ${status}, a redirect${location === undefined ? "" : ` to ${location}`}. The operation does not follow redirects, so set the path that the route serves.`;

describe("sendJob and redirects", () => {
  it.each([301, 302, 303, 307, 308])(
    "rejects HTTP %i at once and names the Location",
    async (status) => {
      const endpoint = new FakeEndpoint();
      endpoint.responses = [
        new Response(null, { status, headers: { location: "/job/" } }),
      ];

      const error = await send(endpoint.fetch, "mvm-1.example", "/job").catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MicrovmRequestRejectedError);
      expect(error).toMatchObject({
        status,
        message: rejection("/job", status, "/job/"),
      });
      expect(endpoint.requests).toHaveLength(1);
      expect(endpoint.requests[0].redirect).toBe("manual");
    },
  );

  it.each([302, 304])(
    "names only the status for HTTP %i without a Location",
    async (status) => {
      const endpoint = new FakeEndpoint();
      endpoint.responses = [new Response(null, { status })];

      const error = await send(endpoint.fetch, "mvm-1.example", "/job").catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MicrovmRequestRejectedError);
      expect(error).toMatchObject({
        status,
        message: `The MicroVM answered the job at /job with HTTP ${status}`,
      });
      expect(endpoint.requests).toHaveLength(1);
    },
  );

  it.each([
    ["a query and a fragment", "/job/?X-Amz-Signature=secret#top", "/job/"],
    ["a long path", `/${"a".repeat(300)}`, `/${"a".repeat(199)}...`],
    ["only a query", "?X-Amz-Signature=secret", undefined],
  ])(
    "drops the query and cuts a long Location: %s",
    async (_label, location, shown) => {
      const endpoint = new FakeEndpoint();
      endpoint.responses = [
        new Response(null, { status: 307, headers: { location } }),
      ];

      const error = await send(endpoint.fetch, "mvm-1.example", "/job").catch(
        (e: unknown) => e,
      );

      expect((error as Error).message).toBe(rejection("/job", 307, shown));
    },
  );

  describe("with the real fetch", () => {
    let server: Server;
    let base: string;
    const received: string[] = [];

    beforeAll(async () => {
      server = createServer((request, response) => {
        received.push(`${request.method} ${request.url}`);
        request.resume();
        request.on("end", () =>
          request.url === "/moved"
            ? response.writeHead(302, { location: "/job?sig=secret" }).end()
            : response.writeHead(200).end(),
        );
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    beforeEach(() => {
      received.length = 0;
    });

    it("does not send the GET that a followed 302 would send", async () => {
      const error = await send(fetch, base, "/moved").catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MicrovmRequestRejectedError);
      expect((error as Error).message).toBe(rejection("/moved", 302, "/job"));
      expect(received).toEqual(["POST /moved"]);
    });

    it("rejects a redirect that a custom fetch follows", async () => {
      const following: typeof fetch = (input, init) =>
        fetch(input, { ...init, redirect: "follow" });

      const error = await send(following, base, "/moved").catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(MicrovmRequestRejectedError);
      expect(error).toMatchObject({
        status: 200,
        message: `The MicroVM answered the job at /moved with a redirect to ${base}/job, and the fetch function followed it. The operation does not follow redirects, so set the path that the route serves, and make the fetch function honor init.redirect.`,
      });
      expect(received).toEqual(["POST /moved", "GET /job?sig=secret"]);
    });
  });
});

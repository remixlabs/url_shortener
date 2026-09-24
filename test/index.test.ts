import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/index";

const ORIGIN = "https://short.test";
const AUTH = { Authorization: "Bearer test-secret" };
const CODE_PATTERN = /^[a-zA-Z0-9]{8}$/;

function request(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, init), env);
}

function shorten(
  body: unknown,
  headers: Record<string, string> = AUTH,
): Promise<Response> {
  return request("/shorten", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /", () => {
  it("returns usage text", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("POST /shorten");
  });
});

describe("POST /shorten", () => {
  it("stores the URL and returns the short code", async () => {
    const url = "https://example.com/some/path?foo=bar";
    const res = await shorten({ url });

    expect(res.status).toBe(201);
    const body = await res.json<{ code: string; short_url: string; url: string }>();
    expect(body.code).toMatch(CODE_PATTERN);
    expect(body.short_url).toBe(`${ORIGIN}/${body.code}`);
    expect(body.url).toBe(url);
    expect(await env.URLS.get(body.code)).toBe(url);
  });

  it("generates a different code each time", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const res = await shorten({ url: "https://example.com" });
      codes.add((await res.json<{ code: string }>()).code);
    }
    expect(codes.size).toBe(20);
  });

  it("rejects requests without an Authorization header", async () => {
    const res = await shorten({ url: "https://example.com" }, {});
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects requests with the wrong secret", async () => {
    const res = await shorten(
      { url: "https://example.com" },
      { Authorization: "Bearer wrong-secret" },
    );
    expect(res.status).toBe(401);
  });

  it("rejects the secret without the Bearer prefix", async () => {
    const res = await shorten(
      { url: "https://example.com" },
      { Authorization: "test-secret" },
    );
    expect(res.status).toBe(401);
  });

  it("rejects all requests when no secret is configured", async () => {
    const noSecretEnv = { ...env, SECRET: "" } as Env;
    const res = await worker.fetch(
      new Request(`${ORIGIN}/shorten`, {
        method: "POST",
        headers: { Authorization: "Bearer " },
        body: JSON.stringify({ url: "https://example.com" }),
      }),
      noSecretEnv,
    );
    expect(res.status).toBe(401);
  });

  it("rejects invalid JSON", async () => {
    const res = await shorten("not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid JSON" });
  });

  it.each([
    ["missing url", {}],
    ["null body", null],
    ["non-string url", { url: 123 }],
    ["malformed url", { url: "not a url" }],
    ["javascript: url", { url: "javascript:alert(1)" }],
    ["ftp: url", { url: "ftp://example.com/file" }],
  ])("rejects %s", async (_, body) => {
    const res = await shorten(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid or missing URL" });
  });

  it("returns 500 if it cannot find an unused code", async () => {
    const puts: string[] = [];
    const fullEnv = {
      ...env,
      URLS: {
        get: async () => "https://taken.example.com",
        put: async (key: string) => void puts.push(key),
      },
    } as unknown as Env;

    const res = await worker.fetch(
      new Request(`${ORIGIN}/shorten`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify({ url: "https://example.com" }),
      }),
      fullEnv,
    );

    expect(res.status).toBe(500);
    expect(puts).toEqual([]);
  });

  it("rejects non-POST methods", async () => {
    const res = await request("/shorten");
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});

describe("GET /:code", () => {
  it("redirects to the stored URL", async () => {
    await env.URLS.put("Abc12345", "https://example.com/target?x=1");
    const res = await request("/Abc12345");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("https://example.com/target?x=1");
  });

  it("returns 404 for an unknown code", async () => {
    const res = await request("/Zzz99999");
    expect(res.status).toBe(404);
  });

  it.each([
    ["too short", "/abc"],
    ["too long", "/abcdefghi"],
    ["invalid characters", "/abc-1234"],
    ["extra path segment", "/Abc12345/extra"],
  ])("returns 404 for a %s code", async (_, path) => {
    await env.URLS.put("Abc12345", "https://example.com");
    const res = await request(path);
    expect(res.status).toBe(404);
  });
});

describe("shorten then redirect", () => {
  it("round-trips a URL", async () => {
    const url = "https://example.com/a/b?c=d&e=f#frag";
    const { code } = await (await shorten({ url })).json<{ code: string }>();

    const res = await request(`/${code}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(url);
  });
});

export interface Env {
  URLS: KVNamespace;
  SECRET: string;
}

const CHARSET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 8;
const CODE_PATTERN = new RegExp(`^[${CHARSET}]{${CODE_LENGTH}}$`);
const MAX_CODE_ATTEMPTS = 5;
// Largest multiple of CHARSET.length that fits in a byte; bytes at or above
// this are discarded so every character is equally likely.
const BYTE_LIMIT = 256 - (256 % CHARSET.length);

function generateCode(): string {
  let code = "";
  while (code.length < CODE_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(CODE_LENGTH))) {
      if (byte < BYTE_LIMIT && code.length < CODE_LENGTH) {
        code += CHARSET[byte % CHARSET.length];
      }
    }
  }
  return code;
}

function isValidUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function isAuthorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const encoder = new TextEncoder();
  const given = encoder.encode(request.headers.get("Authorization") ?? "");
  const expected = encoder.encode(`Bearer ${secret}`);
  return (
    given.byteLength === expected.byteLength &&
    crypto.subtle.timingSafeEqual(given, expected)
  );
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

async function shorten(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env.SECRET)) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (!isValidUrl(body?.url)) {
    return json({ error: "Invalid or missing URL" }, 400);
  }
  const targetUrl = body.url;

  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateCode();
    if ((await env.URLS.get(code)) !== null) continue;

    await env.URLS.put(code, targetUrl);
    const shortUrl = `${new URL(request.url).origin}/${code}`;
    return json({ code, short_url: shortUrl, url: targetUrl }, 201);
  }

  return json({ error: "Could not generate a unique code" }, 500);
}

async function redirect(code: string, env: Env): Promise<Response> {
  if (!CODE_PATTERN.test(code)) {
    return new Response("Not found", { status: 404 });
  }

  const targetUrl = await env.URLS.get(code);
  if (!targetUrl) {
    return new Response("Not found", { status: 404 });
  }

  return Response.redirect(targetUrl, 302);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/shorten") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", {
          status: 405,
          headers: { Allow: "POST" },
        });
      }
      return shorten(request, env);
    }

    if (request.method === "GET" && pathname !== "/") {
      return redirect(pathname.slice(1), env);
    }

    return new Response(
      'URL Shortener\n\nPOST /shorten  { "url": "https://example.com" }\nGET  /:code',
      { headers: { "Content-Type": "text/plain" } },
    );
  },
};

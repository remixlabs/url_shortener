export interface Env {
  EXPERIENCE_URLS: KVNamespace;
  SECRET: string;
}

const CHARSET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LENGTH = 8;

function generateCode(): string {
  let code = "";
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  for (const byte of bytes) {
    code += CHARSET[byte % CHARSET.length];
  }
  return code;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "POST" && path === "/shorten") {
      const auth = request.headers.get("Authorization");
      if (!env.SECRET || auth !== `Bearer ${env.SECRET}`) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      let body: { url?: string };
      try {
        body = await request.json();
      } catch {
        return new Response(JSON.stringify({ error: "Invalid JSON" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const targetUrl = body.url;
      if (!targetUrl || !isValidUrl(targetUrl)) {
        return new Response(
          JSON.stringify({ error: "Invalid or missing URL" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      let code = generateCode();
      // Avoid collisions
      while ((await env.EXPERIENCE_URLS.get(code)) !== null) {
        code = generateCode();
      }

      await env.EXPERIENCE_URLS.put(code, targetUrl);

      const shortUrl = `${url.origin}/${code}`;
      return new Response(
        JSON.stringify({ code, short_url: shortUrl, url: targetUrl }),
        {
          status: 201,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (request.method === "GET" && path.length > 1) {
      const parts = path.slice(1).split("/");
      const code = parts[0];
      const paramsKey = parts[1];

      const targetUrl = await env.EXPERIENCE_URLS.get(code);
      if (!targetUrl) {
        return new Response("Not found", { status: 404 });
      }

      const destination = new URL(targetUrl);
      if (paramsKey) {
        destination.searchParams.set("_rmx_params_key", paramsKey);
      }

      return Response.redirect(destination.toString(), 301);
    }

    return new Response(
      'URL Shortener\n\nPOST /shorten  { "url": "https://example.com" }',
      {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      },
    );
  },
};

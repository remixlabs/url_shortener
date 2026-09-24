# url-shortener

A Cloudflare Worker URL shortener backed by Cloudflare KV.

## Deployment

Live at **https://url-shortener.remixlabs.workers.dev**.

Cloudflare IDs are kept out of the repo. Create a `.env` in the project root (it's git-ignored):

```
CLOUDFLARE_ACCOUNT_ID=<your account id>
SECRET=<written by npm run secret>
```

`npx wrangler whoami` lists the accounts you can use.

```bash
nvm use              # Node 24 (see .nvmrc)
npm install
npx wrangler login   # once per machine
npm run deploy       # runs tests + typecheck, then deploys
```

The KV namespace (`url-shortener-urls`) isn't pinned in `wrangler.toml`: the first deploy created it, and every deploy since reuses the namespace bound to the live worker. Don't delete or rename the worker — a fresh worker gets a new, empty namespace.

Give your calling systems two values: the worker URL and the `SECRET` from `.env`. Keep `.env` out of git (it's already in `.gitignore`). If you don't have the `SECRET` on a new machine, run `npm run secret` to issue a new secret (this replaces the old one, so update your calling systems).

Check it's working:

```bash
source .env
curl -X POST https://url-shortener.remixlabs.workers.dev/shorten \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

To manage keys directly, look up the namespace id with `npx wrangler kv namespace list` and pass `--namespace-id <id> --remote` to `wrangler kv key` commands.

Note: KV is eventually consistent, so overwriting or deleting a key can take up to ~60s to take effect everywhere. New links work immediately.

## Redeploy / rotate the secret

```bash
npm run deploy   # after code changes
npm run secret   # rotate: generates a new secret; update your calling systems with it
```

## Development

```bash
npm run dev
```

`wrangler dev` uses a local KV namespace and reads `SECRET` from `.env`.

## Testing

```bash
npm test            # run once
npm run test:watch  # rerun on change
npm run typecheck
```

Tests run inside the Workers runtime (via `@cloudflare/vitest-pool-workers`) against a local, in-memory KV namespace — no Cloudflare account needed.

## API

### Shorten a URL

```
POST /shorten
Content-Type: application/json
Authorization: Bearer <SECRET>

{ "url": "https://example.com/some/long/path?foo=bar" }
```

Response (`201`):

```json
{
  "code": "aB3xYz12",
  "short_url": "https://your-worker.workers.dev/aB3xYz12",
  "url": "https://example.com/some/long/path?foo=bar"
}
```

### Redirect

```
GET /:code
```

Responds with a `302` redirect to the stored URL, or `404` if the code is unknown.

## Calling from your systems

Any HTTP client works. Example in TypeScript/JavaScript:

```ts
async function shortenUrl(url: string): Promise<string> {
  const res = await fetch(`${process.env.SHORTENER_URL}/shorten`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SHORTENER_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`Shorten failed: ${res.status} ${await res.text()}`);
  const { short_url } = (await res.json()) as { short_url: string };
  return short_url;
}
```

Errors are JSON `{ "error": "..." }` with status `400` (bad input), `401` (bad/missing secret), or `500`.

# experience_url_shortener

A Cloudflare Worker that shortens long experience URLs for use in SMS/RCS messages. Optionally supports passing an external identifier through the short URL path, which is appended to the destination URL as a query parameter for downstream use.

## Prerequisites

- [Node.js](https://nodejs.org)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Wrangler authenticated: `npx wrangler login`

## Setup

```bash
npm install
npm run setup
```

`npm run setup` does the following in one command:

1. Creates a KV namespace in your Cloudflare account to store shortened URLs
2. Updates `wrangler.toml` with the namespace ID
3. Generates a random secret, saves it to `.env`, and uploads it to Cloudflare as a Worker secret — used to authenticate `POST /shorten`
4. Deploys the Worker
5. Runs smoke tests against the live deployment to verify everything works

The secret is saved to `.env` — keep this file safe and do not commit it.

To use a custom KV namespace name (default is `experience_urls`):

```bash
npm run setup -- my_namespace
```

## Development

```bash
npm run dev
```

## Deploy

To redeploy after making changes:

```bash
npm run deploy
```

To rotate the secret:

```bash
npx wrangler secret put SECRET
```

Then update the value in `.env` manually.

## API

### Shorten a URL

```
POST /shorten
Content-Type: application/json
Authorization: Bearer <your-secret>

{ "url": "https://example.com/some/long/path?foo=bar" }
```

Response:

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

Redirects to the stored URL.

### Redirect with external identifier

```
GET /:code/:params_key
```

Redirects to the stored URL with `_rmx_params_key={params_key}` appended as a query parameter. The destination page can use this value for any downstream integration.

**Example:**

Short URL stored as `aB3xYz12` → `https://example.com/experience?screen=home`

User opens `https://your-worker.workers.dev/aB3xYz12/user_abc`

Redirected to `https://example.com/experience?screen=home&_rmx_params_key=user_abc`

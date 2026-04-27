#!/bin/bash
set -e

NAMESPACE=${1:-experience_urls}

echo "Creating KV namespace: $NAMESPACE"
CREATE_OUTPUT=$(npx wrangler kv namespace create "$NAMESPACE" 2>&1)
echo "$CREATE_OUTPUT"
ID=$(echo "$CREATE_OUTPUT" | grep '^id = ' | sed 's/id = "\(.*\)"/\1/')

if [ -z "$ID" ]; then
  echo "Could not parse namespace ID. Paste it manually into wrangler.toml."
  exit 1
fi

# Remove any existing kv_namespaces section and append fresh
perl -i -0pe 's/\n*\[\[kv_namespaces\]\].*//s' wrangler.toml
printf '\n[[kv_namespaces]]\nbinding = "EXPERIENCE_URLS"\nid = "%s"\n' "$ID" >> wrangler.toml
echo "wrangler.toml updated with KV namespace ID."

echo ""
SECRET=$(openssl rand -hex 32)
echo "SECRET=$SECRET" > .env
echo "Secret written to .env — keep this file safe and do not commit it."
echo "$SECRET" | npx wrangler secret put SECRET

echo ""
DEPLOY_OUTPUT=$(npx wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT"
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -o 'https://[^ ]*workers\.dev' | head -1)

if [ -z "$WORKER_URL" ]; then
  echo "Could not parse deployed URL. Skipping smoke tests."
  exit 0
fi

echo ""
echo "Waiting for worker to be live..."
MAX_RETRIES=5
RETRY=0
until [ "$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL")" = "200" ]; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge "$MAX_RETRIES" ]; then
    echo "Worker did not become live after $MAX_RETRIES attempts. Skipping smoke tests."
    exit 1
  fi
  sleep 3
done

echo "Running smoke tests against $WORKER_URL..."

STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL")
if [ "$STATUS" = "200" ]; then
  echo "GET /            ✓ 200"
else
  echo "GET /            ✗ Expected 200, got $STATUS"
  exit 1
fi

SHORTEN_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WORKER_URL/shorten" \
  -H "Authorization: Bearer $SECRET" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}')
SHORTEN_STATUS=$(echo "$SHORTEN_RESPONSE" | tail -1)
SHORTEN_BODY=$(echo "$SHORTEN_RESPONSE" | head -1)
if [ "$SHORTEN_STATUS" = "201" ]; then
  echo "POST /shorten    ✓ 201"
else
  echo "POST /shorten    ✗ Expected 201, got $SHORTEN_STATUS"
  exit 1
fi

CODE=$(echo "$SHORTEN_BODY" | sed 's/.*"code":"\([^"]*\)".*/\1/')
REDIRECT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL/$CODE")
if [ "$REDIRECT_STATUS" = "301" ]; then
  echo "GET /$CODE    ✓ 301"
else
  echo "GET /$CODE    ✗ Expected 301, got $REDIRECT_STATUS"
  exit 1
fi

echo ""
echo "All smoke tests passed. Worker is live at $WORKER_URL"

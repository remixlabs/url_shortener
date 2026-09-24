#!/bin/bash
# Generates a new API secret, uploads it to the deployed worker, and saves it
# to .env (used by `wrangler dev` and for your reference). Re-run to rotate.
set -euo pipefail

SECRET=$(openssl rand -hex 32)
echo "$SECRET" | npx wrangler secret put SECRET

# Replace only the SECRET line so other values in .env are kept.
touch .env
{ grep -v '^SECRET=' .env || true; echo "SECRET=$SECRET"; } > .env.tmp
mv .env.tmp .env

echo ""
echo "Secret saved to .env. Give this value to the systems that call POST /shorten."

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load env vars
set -a
source "$SCRIPT_DIR/.env.test"
set +a

CONVEX_URL="http://127.0.0.1:3210"
ADMIN_KEY="${CONVEX_ADMIN_KEY:?CONVEX_ADMIN_KEY must be set (the backend harness injects it)}"
EXAMPLE_DIR="$SCRIPT_DIR/../examples/react"

# Run convex commands from the example directory so the CLI finds the convex dependency
pushd "$EXAMPLE_DIR" > /dev/null

echo "Setting environment variables on local backend..."
pnpm exec convex env set SITE_URL "$SITE_URL" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY"
pnpm exec convex env set IS_TEST "true" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY"
pnpm exec convex env set BETTER_AUTH_SECRET "e2e-test-secret-key-do-not-use-in-production" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY"

echo "Deploying functions to local backend..."
pnpm exec convex deploy --url "$CONVEX_URL" --admin-key "$ADMIN_KEY" -y

popd > /dev/null

echo "Running Playwright tests..."
pnpm exec playwright test --config "$SCRIPT_DIR/playwright.config.ts"

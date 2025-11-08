#!/bin/sh
set -e

if [ -z "$WANDB_API_KEY" ] || [ -z "$WANDB_PROJECT_ID" ]; then
  echo "❌ Missing WANDB_API_KEY or WANDB_PROJECT_ID"
  exit 1
fi

# Compute base64 auth string for Weave (api:<key>)
# Use -w 0 to prevent line wrapping in base64 output
WANDB_BASIC_AUTH=$(printf "api:%s" "${WANDB_API_KEY}" | base64 | tr -d '\n')

# Weave expects Authorization and project_id headers
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic ${WANDB_BASIC_AUTH},project_id=${WANDB_PROJECT_ID}"

echo "[entrypoint] OTEL headers prepared for Weave endpoint"

# Use NODE_OPTIONS to load tracing module
export NODE_OPTIONS="--require /usr/local/lib/node_modules/n8n/tracing.js"

exec /usr/local/bin/n8n "$@"

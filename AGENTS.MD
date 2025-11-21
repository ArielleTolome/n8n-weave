# n8n-x: AI Agent Observability & Instrumentation

## Overview
This repository hosts a **custom n8n deployment** engineered for **observability of AI/LLM workflows**. It integrates n8n with **Weights & Biases Weave** using OpenTelemetry (OTel) to provide deep insights into agent execution, token usage, and model interactions.

## Core Capabilities

### 1. Deep Telemetry Injection
The system uses a custom instrumentation script (`n8n-otel-instrumentation.js`) to patch n8n's execution engine. This allows it to:
- **Detect AI Nodes**: Automatically identifies nodes interacting with LLMs (OpenAI, Anthropic, LangChain, etc.).
- **Capture Context**: Records inputs, outputs, system prompts, and user messages.
- **Track Usage**: Logs token counts (input/output/total) and model metadata.

### 2. Weave Integration
Traces are formatted specifically for **W&B Weave**, enabling:
- **Visual Tracing**: See the full chain of thought and execution path for AI agents.
- **Cost Monitoring**: Track token usage across different models and workflows.
- **Debuggability**: Inspect exact inputs and outputs for every step of an agent's logic.

## Architecture

- **Docker Image**: Extends `n8n:latest` to include OTel libraries and custom scripts.
- **Entrypoint**: `docker-entrypoint.sh` handles authentication with W&B and preloads the tracing logic.
- **Connectivity**: Uses `cloudflared` to expose the n8n instance securely, likely for handling webhooks from external services or other agents.

## Configuration
- **Environment Variables**:
    - `WANDB_API_KEY`: API key for Weights & Biases.
    - `WANDB_PROJECT_ID`: Target project for telemetry data.
    - `OTEL_EXPORTER_OTLP_ENDPOINT`: Endpoint for sending traces (configured via Weave proxy or direct).

## Testing & Verification

To verify the instrumentation and Weave integration, you can trigger a workflow directly from the command line.

### 1. Run Workflow via CLI
Use the `n8n execute` command inside the running container. Replace the ID with your target workflow.

> **Note**: `n8n execute` does not support passing input parameters (like chat messages). For workflows requiring input, use `curl` to hit the webhook endpoint.

**Option A: Simple Execution (No Inputs)**
```bash
# Test Workflow ID: 9ZTloKJleRrxVyYE
docker exec -it n8n-weave n8n execute --id 9ZTloKJleRrxVyYE
```

**Option B: Passing Parameters (Chat Trigger)**
To test with specific inputs (e.g., a chat message), use `curl` from your host machine or inside the container.

> **Prerequisites**:
> 1. Ensure `curl` is installed in the container: `docker exec -u 0 n8n-weave apk add curl`
> 2. Ensure the workflow is **Active**: `docker exec n8n-weave n8n update:workflow --id=9ZTloKJleRrxVyYE --active=true` (Restart n8n if needed: `docker restart n8n-weave`)

```bash
# Run inside Docker (recommended for connectivity test)
# Note: Chat Triggers use the Webhook ID + /chat suffix
# Webhook ID for workflow 9ZTloKJleRrxVyYE is a889d2ae-2159-402f-b326-5f61e90f602e

docker exec n8n-weave curl -X POST http://localhost:5678/webhook/a889d2ae-2159-402f-b326-5f61e90f602e/chat \
  -H "Content-Type: application/json" \
  -d '{"chatInput": "hello world"}'
```

### 2. Verify in Weave
After running the command, check for new traces in the Weave dashboard:
[https://wandb.ai/thursdai/n8n_tracing/weave/traces](https://wandb.ai/thursdai/n8n_tracing/weave/traces)


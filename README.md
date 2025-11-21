# n8n-weave: AI Agent Observability & Instrumentation

A custom n8n deployment engineered for **observability of AI/LLM workflows**. This project integrates n8n with **Weights & Biases Weave** using OpenTelemetry (OTel) to provide deep insights into agent execution, token usage, and model interactions.

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation & Deployment](#installation--deployment)
- [Configuration](#configuration)
- [Usage](#usage)
- [Testing & Verification](#testing--verification)
- [File Structure](#file-structure)
- [Troubleshooting](#troubleshooting)
- [References](#references)

## 🎯 Overview

n8n-weave extends the standard n8n workflow automation platform with comprehensive OpenTelemetry instrumentation. It automatically captures:

- **Workflow Execution**: Complete trace of workflow runs with timing and status
- **Node Execution**: Individual node-level traces with inputs/outputs
- **AI Model Interactions**: Detailed tracking of LLM calls (OpenAI, Anthropic, LangChain, etc.)
- **Token Usage**: Input/output/total token counts for cost monitoring
- **Model Metadata**: Model names, parameters (temperature, max_tokens, etc.), and responses

All traces are sent to **Weights & Biases Weave** for visualization, analysis, and debugging.

## ✨ Features

### 1. Deep Telemetry Injection
- Automatically detects AI nodes (OpenAI, Anthropic, LangChain, Cohere, Ollama, HuggingFace)
- Captures context including system prompts, user messages, and model responses
- Tracks token usage and model metadata for cost analysis
- Records workflow and node-level execution traces

### 2. Weave Integration
- Native integration with W&B Weave using OTLP/HTTP protocol
- Formatted traces optimized for Weave visualization
- Visual chain-of-thought and execution path rendering
- Cost monitoring across different models and workflows

### 3. Cloudflare Tunnel Support
- Built-in Cloudflare tunnel for secure external access
- Automatic webhook endpoint exposure
- Secure connectivity without opening ports directly

## 🏗️ Architecture

### Components

1. **Docker Image** (`Dockerfile`)
   - Extends `n8n:latest` official image
   - Installs OpenTelemetry packages globally
   - Includes custom instrumentation scripts

2. **Entrypoint Script** (`docker-entrypoint.sh`)
   - Sets up W&B authentication headers
   - Configures OTLP exporter with Weave credentials
   - Preloads tracing module via `NODE_OPTIONS`

3. **Tracing Bootstrap** (`tracing.js`)
   - Initializes OpenTelemetry SDK
   - Configures OTLP trace and log exporters
   - Registers auto-instrumentations for OpenAI, Anthropic, LangChain
   - Sets up custom n8n instrumentation

4. **Custom Instrumentation** (`n8n-otel-instrumentation.js`)
   - Patches n8n's `WorkflowExecute` class
   - Captures workflow execution spans
   - Captures individual node execution spans
   - Extracts AI-specific attributes (model, tokens, messages)

5. **Docker Compose** (`docker-compose.yaml`)
   - Orchestrates n8n and cloudflared services
   - Manages networking and volumes
   - Handles environment variables

6. **Cloudflare Tunnel** (`cloudflared/`)
   - Exposes n8n instance securely to the internet
   - Enables webhook reception from external services

### Data Flow

```
n8n Workflow Execution
    ↓
Custom Instrumentation (n8n-otel-instrumentation.js)
    ↓
OpenTelemetry SDK (tracing.js)
    ↓
OTLP Exporter (with W&B headers)
    ↓
Weights & Biases Weave
    ↓
Visualization Dashboard
```

## 📦 Prerequisites

- **Docker** (version 20.10+)
- **Docker Compose** (version 2.0+)
- **Weights & Biases Account** with:
  - API key (`WANDB_API_KEY`)
  - Project ID (`WANDB_PROJECT_ID`)
  - OTLP endpoint URL (`WEAVE_OTLP_ENDPOINT`)
- **Cloudflare Account** (optional, for tunnel functionality)
  - Tunnel credentials (`cloudflared/n8n-tunnel.json`)

### Getting Weave OTLP Endpoint

1. Log in to [Weights & Biases](https://wandb.ai)
2. Navigate to your project
3. Go to **Settings** → **Weave** → **OTLP Integration**
4. Copy the OTLP/HTTP ingest endpoint URL
5. See [Weave OTLP Documentation](https://docs.wandb.ai/weave/guides/tracking/otel) for enterprise configurations

## 🚀 Installation & Deployment

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd n8n-weave
```

### Step 2: Configure Environment Variables

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# From Weave settings (OTLP/HTTP ingest endpoint)
WEAVE_OTLP_ENDPOINT=https://collector.weave.example/v1/traces
WANDB_API_KEY=your_wandb_api_key_here
WANDB_PROJECT_ID=entity/project
DEBUG_OTEL=true   # set to false once it's working
```

**Important Environment Variables:**
- `WEAVE_OTLP_ENDPOINT`: Your Weave OTLP endpoint URL (from W&B settings)
- `WANDB_API_KEY`: Your W&B API key (found in W&B account settings)
- `WANDB_PROJECT_ID`: Your W&B entity and project (e.g., `username/my-project`)
- `DEBUG_OTEL`: Enable debug logging for OpenTelemetry (set to `false` in production)

### Step 3: Build the Docker Image

Build the custom n8n image with OpenTelemetry instrumentation:

```bash
docker-compose build
```

This will:
- Extend the official n8n image
- Install OpenTelemetry packages globally
- Copy instrumentation scripts
- Set up the custom entrypoint

### Step 4: Configure Cloudflare Tunnel (Optional)

If you want to use Cloudflare tunnel for external access:

1. **Obtain Tunnel Credentials:**
   - Create a tunnel in Cloudflare dashboard
   - Download the tunnel credentials JSON
   - Save it as `cloudflared/n8n-tunnel.json`

2. **Update Tunnel Configuration:**
   - Edit `cloudflared/config.yml` with your hostname
   - Update the service URL if needed

**Note:** If you don't need Cloudflare tunnel, you can:
- Remove the `cloudflared` service from `docker-compose.yaml`
- Access n8n via `http://localhost:5678` (port 5678 is exposed)

### Step 5: Start the Services

Start all services using Docker Compose:

```bash
docker-compose up -d
```

This will:
- Build and start the n8n container (`n8n-weave`)
- Start the Cloudflare tunnel container (if configured)
- Create necessary volumes and networks

### Step 6: Verify Deployment

1. **Check Container Status:**
   ```bash
   docker-compose ps
   ```

2. **View Logs:**
   ```bash
   # View n8n logs
   docker-compose logs -f n8n
   
   # View all logs
   docker-compose logs -f
   ```

3. **Access n8n UI:**
   - Local: `http://localhost:5678`
   - Cloudflare tunnel: `https://your-hostname.cloudflare.com` (if configured)

4. **Verify OpenTelemetry Initialization:**
   Look for these log messages:
   ```
   [OTEL] Starting Weave hybrid trace bootstrap
   [OTEL] Export endpoint: https://...
   [OTEL] Tracing started for service=n8n
   ```

## ⚙️ Configuration

### Environment Variables

The following environment variables can be configured in `.env`:

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `WEAVE_OTLP_ENDPOINT` | W&B Weave OTLP endpoint URL | Yes | - |
| `WANDB_API_KEY` | Weights & Biases API key | Yes | - |
| `WANDB_PROJECT_ID` | W&B entity/project ID | Yes | - |
| `DEBUG_OTEL` | Enable OpenTelemetry debug logs | No | `false` |
| `OTEL_SERVICE_NAME` | Service name for traces | No | `n8n` |
| `N8N_PROXY_HOPS` | Proxy hops configuration | No | `1` |

### Docker Compose Configuration

Key settings in `docker-compose.yaml`:

- **Ports:** n8n exposes port `5678` (can be changed if needed)
- **Volumes:** n8n data is persisted in `./n8n_data`
- **Networks:** Services communicate via `n8n-net` bridge network

### Instrumentation Configuration

The instrumentation automatically detects and tracks:

- **AI Providers:** OpenAI, Anthropic, LangChain, Cohere, Ollama, HuggingFace
- **Node Types:** Chat, Completion, Agent, Tool, Chain, Retriever
- **Attributes Captured:**
  - Model name (`gen_ai.request.model`)
  - Token usage (`gen_ai.usage.*`)
  - Input messages (`gen_ai.input.messages`)
  - Output messages (`gen_ai.output.messages`)
  - System instructions (`gen_ai.system_instructions`)
  - Model parameters (temperature, max_tokens, etc.)

## 📖 Usage

### Creating Workflows with AI Nodes

1. Access n8n UI at `http://localhost:5678`
2. Create a new workflow
3. Add AI nodes (OpenAI, Anthropic, etc.)
4. Configure your models and API keys
5. Run the workflow

All AI node executions will automatically be traced and sent to Weave.

### Viewing Traces in Weave

1. Navigate to your W&B project
2. Open the **Weave** tab
3. View traces in real-time as workflows execute
4. Inspect individual spans for:
   - Input/output messages
   - Token usage
   - Model parameters
   - Execution timing
   - Error details

### Example Workflow

A typical AI workflow might include:
- **Chat Trigger** → Receives user input
- **OpenAI Node** → Processes the input
- **Function Node** → Transforms the output
- **HTTP Request** → Calls external API

Each step will be traced with full context.

## 🧪 Testing & Verification

### Test Workflow Execution

#### Option A: Simple Execution (No Inputs)

Execute a workflow directly via CLI:

```bash
# Replace with your workflow ID
docker exec -it n8n-weave n8n execute --id <WORKFLOW_ID>
```

**Note:** `n8n execute` does not support passing input parameters. For workflows requiring input, use webhooks.

#### Option B: Webhook Execution (With Inputs)

For workflows with Chat Trigger or Webhook nodes:

1. **Install curl in container** (if not already installed):
   ```bash
   docker exec -u 0 n8n-weave apk add curl
   ```

2. **Ensure workflow is active:**
   ```bash
   docker exec n8n-weave n8n update:workflow --id=<WORKFLOW_ID> --active=true
   ```

3. **Get webhook URL:**
   - In n8n UI, open your workflow
   - Copy the webhook URL from the Webhook/Chat Trigger node

4. **Trigger workflow:**
   ```bash
   # For Chat Trigger
   docker exec n8n-weave curl -X POST http://localhost:5678/webhook/<WEBHOOK_ID>/chat \
     -H "Content-Type: application/json" \
     -d '{"chatInput": "hello world"}'
   
   # For regular Webhook
   docker exec n8n-weave curl -X POST http://localhost:5678/webhook/<WEBHOOK_ID> \
     -H "Content-Type: application/json" \
     -d '{"key": "value"}'
   ```

### Verify Traces in Weave

After executing a workflow:

1. Check the Weave dashboard: `https://wandb.ai/<entity>/<project>/weave/traces`
2. Look for new traces matching your workflow execution
3. Inspect spans to verify:
   - Workflow name and ID
   - Node executions
   - AI model calls with token usage
   - Input/output data

### Debug Mode

To enable detailed OpenTelemetry logging:

1. Set `DEBUG_OTEL=true` in `.env`
2. Restart containers: `docker-compose restart`
3. View logs: `docker-compose logs -f n8n`

You should see detailed logs like:
```
[OTEL] Starting Weave hybrid trace bootstrap
[OTEL] Export endpoint: https://...
[OTEL] Tracing started for service=n8n
[OTEL] workflow span started
[OTEL] node span started
```

## 📁 File Structure

```
n8n-weave/
├── Dockerfile                      # Custom n8n image with OTel
├── docker-compose.yaml             # Service orchestration
├── docker-entrypoint.sh            # Entrypoint with W&B auth setup
├── tracing.js                      # OpenTelemetry SDK bootstrap
├── n8n-otel-instrumentation.js     # Custom n8n instrumentation
├── .env.example                    # Environment variables template
├── cloudflared/
│   ├── config.yml                  # Cloudflare tunnel configuration
│   └── n8n-tunnel.json             # Tunnel credentials (not in git)
├── n8n_data/                       # Persistent n8n data (workflows, DB)
│   ├── database.sqlite
│   ├── config/
│   └── export/
└── exported/                       # Exported workflows backup
```

### Key Files Explained

- **`Dockerfile`**: Extends n8n image, installs OTel packages, copies scripts
- **`docker-entrypoint.sh`**: Sets up authentication, loads tracing module
- **`tracing.js`**: Initializes OTel SDK, configures exporters, registers instrumentations
- **`n8n-otel-instrumentation.js`**: Patches n8n classes to capture execution traces
- **`docker-compose.yaml`**: Defines services, networks, volumes, environment
- **`cloudflared/config.yml`**: Tunnel routing configuration

## 🔧 Troubleshooting

### Issue: Traces not appearing in Weave

**Possible Causes:**
1. Incorrect `WEAVE_OTLP_ENDPOINT`
2. Invalid `WANDB_API_KEY`
3. Wrong `WANDB_PROJECT_ID` format
4. Network connectivity issues

**Solutions:**
1. Verify environment variables:
   ```bash
   docker exec n8n-weave env | grep -E "(WANDB|OTEL)"
   ```
2. Check logs for errors:
   ```bash
   docker-compose logs n8n | grep -i otel
   ```
3. Enable debug mode (`DEBUG_OTEL=true`) and check detailed logs
4. Verify Weave endpoint is accessible from container:
   ```bash
   docker exec n8n-weave wget -O- $WEAVE_OTLP_ENDPOINT
   ```

### Issue: Container fails to start

**Possible Causes:**
1. Missing environment variables
2. Invalid Docker image build
3. Port conflicts

**Solutions:**
1. Ensure `.env` file exists and is properly formatted
2. Rebuild image: `docker-compose build --no-cache`
3. Check port availability: `lsof -i :5678`
4. View startup logs: `docker-compose logs n8n`

### Issue: AI nodes not being traced

**Possible Causes:**
1. Node type not recognized
2. Instrumentation not loaded
3. Custom node types

**Solutions:**
1. Check if node type includes keywords: `openai`, `anthropic`, `langchain`, etc.
2. Verify instrumentation loaded: look for `[OTEL] Applying n8n OpenTelemetry instrumentation` in logs
3. Check node execution logs: `docker-compose logs n8n | grep "runNode"`

### Issue: Cloudflare tunnel not working

**Possible Causes:**
1. Missing tunnel credentials
2. Invalid configuration
3. Network issues

**Solutions:**
1. Verify `cloudflared/n8n-tunnel.json` exists and is valid
2. Check tunnel logs: `docker-compose logs cloudflared`
3. Test tunnel connection: `docker exec cloudflared cloudflared tunnel info`

### Common Commands

```bash
# View all logs
docker-compose logs -f

# Restart services
docker-compose restart

# Rebuild and restart
docker-compose up -d --build

# Execute workflow
docker exec -it n8n-weave n8n execute --id <WORKFLOW_ID>

# Access n8n shell
docker exec -it n8n-weave sh

# Check environment variables
docker exec n8n-weave env

# View container status
docker-compose ps
```

## 📚 References

- [n8n Documentation](https://docs.n8n.io/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Weights & Biases Weave](https://wandb.ai/weave)
- [Weave OTLP Integration Guide](https://docs.wandb.ai/weave/guides/tracking/otel)
- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)

## 📝 License

[Add your license here]

## 🤝 Contributing

[Add contributing guidelines here]

---

**Built with ❤️ for AI observability**


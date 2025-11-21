# Implementation Guide: n8n + Weave Integration

This guide explains how to implement OpenTelemetry tracing for n8n with Weights & Biases Weave integration.

## Prerequisites

1. **Weights & Biases Account**
   - Sign up at https://wandb.ai
   - Get your API key from https://wandb.ai/authorize
   - Note your entity/project name (format: `entity/project`)

2. **Weave OTLP Endpoint**
   - Enterprise: Use your configured endpoint
   - Cloud: Use `https://api.wandb.ai/integrations/v1/otel/traces`
   - See: https://docs.wandb.ai/weave/guides/tracking/otel

3. **Docker & Docker Compose**
   - Docker Desktop or Docker Engine installed
   - Docker Compose v3.8+

## Implementation Steps

### Step 1: Clone or Copy Required Files

You need these files from this repository:

```
├── Dockerfile                    # Custom n8n image with OTel
├── docker-entrypoint.sh          # Entrypoint with W&B auth
├── tracing.js                    # OTel SDK initialization
├── n8n-otel-instrumentation.js   # n8n patching logic
├── docker-compose.yaml           # Service orchestration
└── .env                          # Environment variables (create from .env.example)
```

### Step 2: Create Environment Configuration

Create a `.env` file in your project root:

```bash
# From Weave settings (OTLP/HTTP ingest endpoint)
WEAVE_OTLP_ENDPOINT=https://api.wandb.ai/integrations/v1/otel/traces
WANDB_API_KEY=your_wandb_api_key_here
WANDB_PROJECT_ID=your_entity/your_project
DEBUG_OTEL=true   # Set to false once working
```

**Key Points:**
- `WEAVE_OTLP_ENDPOINT`: OTLP endpoint for sending traces
- `WANDB_API_KEY`: Your W&B API key (starts with `api-...`)
- `WANDB_PROJECT_ID`: Format is `entity/project` (e.g., `thursdai/n8n_tracing`)
- `DEBUG_OTEL`: Enable verbose logging during setup

### Step 3: Understand the Dockerfile

The Dockerfile extends the official n8n image and adds:

1. **OpenTelemetry Packages** (installed globally):
   ```dockerfile
   @opentelemetry/api
   @opentelemetry/sdk-node
   @opentelemetry/exporter-trace-otlp-proto
   @arizeai/openinference-semantic-conventions
   @traceloop/instrumentation-langchain
   @elastic/opentelemetry-instrumentation-openai
   @traceloop/instrumentation-anthropic
   ```

2. **Custom Scripts**:
   - `tracing.js`: Initializes OTel SDK
   - `n8n-otel-instrumentation.js`: Patches n8n's execution engine

3. **Entrypoint**: `docker-entrypoint.sh` sets up authentication

### Step 4: How the Instrumentation Works

#### A. Entrypoint (`docker-entrypoint.sh`)

This script:
1. Validates `WANDB_API_KEY` and `WANDB_PROJECT_ID`
2. Creates base64 Basic Auth header: `api:${WANDB_API_KEY}`
3. Sets `OTEL_EXPORTER_OTLP_HEADERS` with Authorization + project_id
4. Loads `tracing.js` via `NODE_OPTIONS=--require`

#### B. Tracing Initialization (`tracing.js`)

This file:
1. **Initializes OTel SDK** with Weave exporter
2. **Registers Instrumentations**:
   - Auto-instrumentations (HTTP, DNS, etc. - most disabled for noise reduction)
   - LangChain instrumentation
   - OpenAI instrumentation  
   - Anthropic instrumentation
3. **Loads n8n patching** via `setupN8nOpenTelemetry()`
4. **Handles shutdown** gracefully

#### C. n8n Patching (`n8n-otel-instrumentation.js`)

This is the core instrumentation that patches n8n's internal methods:

**1. Workflow Execution Patching:**
```javascript
WorkflowExecute.prototype.processRunExecutionData = function(workflow) {
  // Creates a root span for each workflow execution
  // Captures: workflow ID, name, settings
  // Sets span status on errors
}
```

**2. Node Execution Patching:**
```javascript
WorkflowExecute.prototype.runNode = async function(...) {
  // Creates spans for each node execution
  // Detects AI nodes (OpenAI, Anthropic, etc.)
  // Extracts: model, prompts, messages, system instructions
  // Captures: inputs, outputs, token usage
  // Formats data for Weave compatibility
}
```

**Key Detection Logic:**
- Checks `node.type` for AI providers (openai, anthropic, huggingface, etc.)
- Extracts model from `node.parameters.model` or `node.parameters.modelName`
- Captures messages/prompts from node parameters
- Extracts token usage from output data
- Builds Weave-compatible payloads with `inputs`, `outputs`, `usage`, `metadata`

### Step 5: Deploy with Docker Compose

1. **Build the image**:
   ```bash
   docker-compose build
   ```

2. **Start services**:
   ```bash
   docker-compose up -d
   ```

3. **Check logs** (ensure no errors):
   ```bash
   docker-compose logs -f n8n
   ```

4. **Access n8n UI**:
   - Local: http://localhost:5678
   - Via Cloudflare tunnel (if configured): Use your tunnel URL

### Step 6: Verify Integration

#### Test 1: Check Logs for OTel Initialization
```bash
docker logs n8n-weave | grep OTEL
```

You should see:
- `[OTEL] Starting Weave hybrid trace bootstrap`
- `[OTEL] Exporters initialized for Weave`
- `[OTEL] Tracing started for service=n8n`

#### Test 2: Run a Workflow

**Option A: Execute via CLI (no inputs)**
```bash
# Get workflow ID from n8n UI
docker exec -it n8n-weave n8n execute --id YOUR_WORKFLOW_ID
```

**Option B: Trigger via Webhook (with inputs)**
```bash
# Get webhook URL from workflow settings
docker exec n8n-weave curl -X POST http://localhost:5678/webhook/YOUR_WEBHOOK_ID \
  -H "Content-Type: application/json" \
  -d '{"chatInput": "test message"}'
```

#### Test 3: Check Weave Dashboard

Visit: `https://wandb.ai/YOUR_ENTITY/YOUR_PROJECT/weave/traces`

You should see:
- Workflow execution spans (root level)
- Node execution spans (nested under workflows)
- AI node spans with model info, inputs, outputs, token usage

### Step 7: Understanding Trace Structure

Traces are structured hierarchically:

```
n8n.workflow.execute (root span)
├── workflow.id: "abc123"
├── workflow.name: "My AI Workflow"
└── Child spans:
    ├── node-1-name (regular node)
    ├── openai-chat-node (AI node)
    │   ├── gen_ai.provider.name: "openai"
    │   ├── gen_ai.request.model: "gpt-4"
    │   ├── gen_ai.input.messages: [...]
    │   ├── gen_ai.output.messages: [...]
    │   ├── gen_ai.usage.input_tokens: 150
    │   ├── gen_ai.usage.output_tokens: 200
    │   └── gen_ai.usage.total_tokens: 350
    └── node-3-name (another node)
```

### Step 8: Customization Options

#### Enable Debug Mode
Set `DEBUG_OTEL=true` in `.env` to see verbose logging:
- Workflow/node execution details
- Input/output data dumps
- Span creation events

#### Disable Auto-Instrumentations
Edit `tracing.js` to enable/disable specific instrumentations:
```javascript
const auto = getNodeAutoInstrumentations({
  '@opentelemetry/instrumentation-http': { enabled: true }, // Enable HTTP
  '@opentelemetry/instrumentation-dns': { enabled: false },  // Disable DNS
});
```

#### Add Custom Attributes
In `n8n-otel-instrumentation.js`, add custom attributes:
```javascript
span.setAttribute("custom.my.attribute", value);
```

### Step 9: Production Considerations

1. **Disable Debug Mode**:
   ```bash
   DEBUG_OTEL=false
   ```

2. **Persistent Storage**:
   Ensure `n8n_data` volume is backed up:
   ```yaml
   volumes:
     - ./n8n_data:/home/node/.n8n
   ```

3. **Security**:
   - Never commit `.env` file
   - Use Docker secrets or environment variable managers
   - Restrict cloudflared tunnel access if using

4. **Performance**:
   - OTel adds minimal overhead (~5-10ms per span)
   - Disable noisy instrumentations if needed
   - Monitor trace volume in W&B

### Troubleshooting

#### No Traces in Weave
1. **Check Authentication**:
   ```bash
   docker exec n8n-weave env | grep WANDB
   docker exec n8n-weave env | grep OTEL
   ```

2. **Verify Endpoint**:
   - Test endpoint manually: `curl -X POST $WEAVE_OTLP_ENDPOINT`
   - Check firewall/proxy settings

3. **Check Logs**:
   ```bash
   docker logs n8n-weave 2>&1 | grep -i error
   ```

#### Missing AI Node Attributes
- Ensure AI nodes have model/prompt parameters set
- Check node type detection logic matches your node types
- Enable `DEBUG_OTEL=true` to see what's captured

#### Traces Not Hierarchical
- Verify n8n-core is properly patched
- Check that `WorkflowExecute.prototype` methods are patched before first use
- Ensure OpenTelemetry context propagation is working

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│  n8n Workflow Execution                 │
│  (WorkflowExecute.processRunExecutionData)│
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  n8n-otel-instrumentation.js            │
│  • Patches WorkflowExecute              │
│  • Creates workflow spans               │
│  • Creates node spans                   │
│  • Extracts AI metadata                 │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  OpenTelemetry SDK (tracing.js)         │
│  • Manages spans                        │
│  • Formats trace data                   │
│  • Handles context propagation          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  OTLP Exporter                          │
│  • Encodes traces (protobuf)            │
│  • Adds W&B auth headers                │
│  • Sends to Weave endpoint              │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│  Weights & Biases Weave                 │
│  • Stores traces                        │
│  • Visualizes execution flows           │
│  • Tracks token usage                   │
└─────────────────────────────────────────┘
```

## Next Steps

1. **Integrate with Existing n8n**: Copy files to your n8n project
2. **Configure Environment**: Set up `.env` with your W&B credentials
3. **Test with Simple Workflow**: Create a workflow with an AI node
4. **Monitor in Weave**: Verify traces appear in dashboard
5. **Scale**: Apply to production workflows

## Support

For issues or questions:
- Check logs: `docker logs n8n-weave`
- Enable debug: `DEBUG_OTEL=true`
- Review W&B Weave docs: https://docs.wandb.ai/weave


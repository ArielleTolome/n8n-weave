# Portainer Quick Start Guide: Deploy n8n-weave

This guide walks you through deploying n8n-weave using Portainer's container creation UI, step-by-step.

## Prerequisites

Before starting, gather these values:
- **W&B API Key**: From [wandb.ai/settings](https://wandb.ai/settings)
- **W&B Project ID**: Format `entity/project` (e.g., `thursdai/n8n_tracing`)
- **Weave OTLP Endpoint**: From W&B project settings → Weave → OTLP Integration

## Step 1: Build the Docker Image (First Time Only)

You need to build the custom n8n image before deploying. Choose one method:

### Option A: Build via Portainer

1. In Portainer, go to **Images** → **Build a new image**
2. Choose **Upload** method
3. Upload these files:
   - `Dockerfile`
   - `docker-entrypoint.sh`
   - `tracing.js`
   - `n8n-otel-instrumentation.js`
4. Set **Image name**: `n8n-weave-otel:latest`
5. Click **Build the image**

### Option B: Build via Command Line

```bash
# On your Portainer host
cd /path/to/n8n-weave
docker build -t n8n-weave-otel:latest .
```

## Step 2: Create Container in Portainer

### Basic Configuration

1. **Navigate to Containers**
   - Click **Containers** in the left menu
   - Click **Add container**

2. **Name**
   - Enter: `n8n-weave`

3. **Image Configuration**
   - **Image**: `n8n-weave-otel:latest`
   - **Always pull the image**: Toggle **ON** (if using remote registry) or **OFF** (if built locally)

### Network Ports Configuration

1. **Port Mapping**
   - Click **+ map additional port**
   - **Container**: `5678`
   - **Host**: `5678`
   - **Protocol**: TCP

### Volumes

1. **Map Additional Volume**
   - Click **+ map additional volume**
   - **Container**: `/home/node/.n8n`
   - **Volume/Bind**: Choose **Bind** and enter host path:
     - Example: `/opt/n8n-weave/n8n_data`
     - **Important**: Create this directory first on your host:
       ```bash
       mkdir -p /opt/n8n-weave/n8n_data
       chmod 755 /opt/n8n-weave/n8n_data
       ```

### Environment Variables

Click **Environment** tab (or scroll to Environment section) and add these variables:

| Variable Name | Value | Notes |
|--------------|-------|-------|
| `WANDB_API_KEY` | `your_api_key_here` | Your W&B API key |
| `WANDB_PROJECT_ID` | `entity/project` | e.g., `thursdai/n8n_tracing` |
| `WEAVE_OTLP_ENDPOINT` | `https://...` | From W&B Weave settings |
| `OTEL_SERVICE_NAME` | `n8n` | Service name for traces |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | OTLP protocol |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Same as `WEAVE_OTLP_ENDPOINT` | Copy from above |
| `DEBUG_OTEL` | `true` | Set to `false` once working |
| `N8N_PROXY_HOPS` | `1` | Proxy configuration |

**To add each variable:**
1. Click **Add environment variable**
2. Enter **Name** and **Value**
3. Repeat for all variables above

### Restart Policy

1. Scroll to **Restart policy** section
2. Select: **Always**

### Advanced Settings (Optional)

Click **Advanced mode** or navigate to **Advanced container settings**:

#### Commands & Logging Tab

- **Command**: Leave as **Default** (don't override)
- **Entrypoint**: Leave as **Default** (don't override)
- **Console**: Select **None** (default)
- **Logging**: Leave as **Default logging driver**

#### Network Tab

- **Network**: Create new network or use existing
  - If creating new: Name `n8n-net`, Driver `bridge`

#### Env Tab

- All environment variables should already be set in the main form

### Access Control

1. **Enable access control**: Toggle **ON** (recommended)
2. Select **Administrators** (restrict to admins only)

## Step 3: Deploy

1. Review all settings
2. Click **Deploy the container** at the bottom
3. Wait for container to start (status should turn green)

## Step 4: Verify Deployment

### Check Container Status

1. Go to **Containers** → **n8n-weave**
2. Status should be **Running** (green)

### View Logs

1. Click on **n8n-weave** container
2. Go to **Logs** tab
3. Look for these messages:
   ```
   [entrypoint] OTEL headers prepared for Weave endpoint
   [OTEL] Starting Weave hybrid trace bootstrap
   [OTEL] Export endpoint: https://...
   [OTEL] Tracing started for service=n8n
   ```

### Access n8n UI

1. Open browser: `http://your-host-ip:5678`
2. Complete n8n setup wizard (first time only)
3. Create a test workflow with an AI node
4. Execute the workflow

### Verify Traces in Weave

1. Go to: `https://wandb.ai/<entity>/<project>/weave/traces`
2. You should see traces from your workflow execution

## Step 5: Deploy Cloudflared (Optional)

If you want to expose n8n via Cloudflare tunnel:

1. **Create Another Container**
   - **Name**: `cloudflared`
   - **Image**: `cloudflare/cloudflared:latest`

2. **Command**
   - Go to **Advanced container settings** → **Commands & logging**
   - **Command**: Select **Override**
   - Enter: `tunnel run n8n-tunnel`

3. **Volumes**
   - **Container**: `/etc/cloudflared`
   - **Host**: `/opt/n8n-weave/cloudflared` (with `n8n-tunnel.json` and `config.yml`)

4. **Network**
   - Use same network as `n8n-weave` (e.g., `n8n-net`)

5. **Restart Policy**: **Always**

6. **Deploy**

## Troubleshooting

### Container Won't Start

- **Check logs**: Container → **Logs** tab
- **Verify environment variables**: All required vars must be set
- **Check volume path**: Ensure directory exists and has correct permissions
- **Port conflict**: Ensure port 5678 is not in use

### No Traces in Weave

- **Verify credentials**: Check `WANDB_API_KEY` and `WANDB_PROJECT_ID`
- **Check endpoint**: Ensure `WEAVE_OTLP_ENDPOINT` is correct
- **Enable debug**: Set `DEBUG_OTEL=true` and check logs
- **Network connectivity**: Container must be able to reach Weave endpoint

### Permission Errors

- **Fix volume permissions**:
  ```bash
  sudo chown -R 1000:1000 /opt/n8n-weave/n8n_data
  ```

## Quick Reference

### Required Environment Variables
```
WANDB_API_KEY=your_key
WANDB_PROJECT_ID=entity/project
WEAVE_OTLP_ENDPOINT=https://collector.weave.example/v1/traces
OTEL_SERVICE_NAME=n8n
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_ENDPOINT=${WEAVE_OTLP_ENDPOINT}
DEBUG_OTEL=true
N8N_PROXY_HOPS=1
```

### Volume Mount
- **Container**: `/home/node/.n8n`
- **Host**: `/opt/n8n-weave/n8n_data` (or your chosen path)

### Port Mapping
- **Host**: `5678` → **Container**: `5678`

---

**Need more details?** See [PORTAINER_DEPLOYMENT.md](./PORTAINER_DEPLOYMENT.md) for comprehensive documentation.


# Portainer Deployment Guide for n8n-weave

This guide walks you through deploying **n8n-weave** (custom n8n with Weights & Biases Weave observability) using Portainer.

## 📋 Prerequisites

Before starting, ensure you have:

- **Portainer** installed and accessible
- **Docker** and **Docker Compose** available on your Portainer host
- **Weights & Biases Account** with:
  - API key (`WANDB_API_KEY`)
  - Project ID (`WANDB_PROJECT_ID`)
  - OTLP endpoint URL (`WEAVE_OTLP_ENDPOINT`)
- **Git access** to clone this repository, or access to the project files
- **Cloudflare Account** (optional, for tunnel functionality)

## 🎯 Deployment Options

Portainer supports multiple deployment methods. Choose the one that best fits your setup:

1. **[Docker Compose Stack](#method-1-docker-compose-stack-recommended)** (Recommended)
   - Best for: Full project deployment with all services
   - Pros: Easy management, automatic networking, environment variables from `.env`
   - Cons: Requires file access on Portainer host

2. **[Custom Container from Image](#method-2-custom-container-from-image)**
   - Best for: Pre-built images or existing image registry
   - Pros: Quick deployment, no build step needed
   - Cons: Requires building/pushing image first, manual configuration

3. **[Build & Deploy via Portainer](#method-3-build--deploy-via-portainer)**
   - Best for: Building custom images directly in Portainer
   - Pros: No external build tools needed, integrated workflow
   - Cons: Requires Dockerfile and project files

---

## Method 1: Docker Compose Stack (Recommended)

This is the easiest and most maintainable approach. Portainer can deploy Docker Compose stacks directly.

### Step 1: Prepare Files on Portainer Host

You need to have the project files accessible on your Portainer host. Options:

#### Option A: Clone Repository on Host
```bash
# SSH into your Portainer host
ssh user@portainer-host

# Clone the repository
git clone <repository-url>
cd n8n-weave
```

#### Option B: Upload Files via Portainer
1. In Portainer, go to **Stacks** → **Add Stack**
2. Use the **Web editor** option (for docker-compose.yaml)
3. Or use **Upload** option to upload files

### Step 2: Configure Environment Variables

Create a `.env` file in the project directory:

```bash
# On Portainer host
cd /path/to/n8n-weave
cp .env.example .env
nano .env  # or use your preferred editor
```

Fill in your values:

```env
# From Weave settings (OTLP/HTTP ingest endpoint)
WEAVE_OTLP_ENDPOINT=https://collector.weave.example/v1/traces
WANDB_API_KEY=your_wandb_api_key_here
WANDB_PROJECT_ID=entity/project
DEBUG_OTEL=true   # set to false once it's working
```

**Getting Your Weave OTLP Endpoint:**
1. Log in to [Weights & Biases](https://wandb.ai)
2. Navigate to your project
3. Go to **Settings** → **Weave** → **OTLP Integration**
4. Copy the OTLP/HTTP ingest endpoint URL

### Step 3: Build the Docker Image

Before deploying the stack, build the custom n8n image:

```bash
# On Portainer host
cd /path/to/n8n-weave
docker build -t n8n-weave-otel:latest .
```

**Or build via Portainer:**
1. In Portainer, go to **Images** → **Build a new image**
2. Set **Build method** to **Upload**
3. Upload the `Dockerfile` and required files:
   - `Dockerfile`
   - `docker-entrypoint.sh`
   - `tracing.js`
   - `n8n-otel-instrumentation.js`
4. Set **Image name** to: `n8n-weave-otel:latest`
5. Click **Build the image**

### Step 4: Configure Cloudflare Tunnel (Optional)

If you want to use Cloudflare tunnel for external access:

1. **Create Tunnel in Cloudflare:**
   - Go to Cloudflare Dashboard → **Zero Trust** → **Networks** → **Tunnels**
   - Create a new tunnel
   - Download the tunnel credentials JSON

2. **Add Credentials to Host:**
   ```bash
   # Create cloudflared directory
   mkdir -p /path/to/n8n-weave/cloudflared
   
   # Copy tunnel credentials
   cp /path/to/downloaded/tunnel-credentials.json /path/to/n8n-weave/cloudflared/n8n-tunnel.json
   ```

3. **Update Tunnel Config:**
   Edit `cloudflared/config.yml` with your hostname:
   ```yaml
   tunnel: n8n-tunnel
   credentials-file: /etc/cloudflared/n8n-tunnel.json
   
   ingress:
     - hostname: your-n8n.example.com
       service: http://n8n:5678
     - service: http_status:404
   ```

**Note:** If you don't need Cloudflare tunnel, you can:
- Comment out the `cloudflared` service in `docker-compose.yaml`
- Access n8n via `http://host-ip:5678` (if port is exposed)

### Step 5: Deploy Stack in Portainer

1. **Open Portainer UI:**
   - Navigate to **Stacks** in the left menu
   - Click **Add Stack**

2. **Configure Stack:**
   - **Name**: `n8n-weave`
   - **Build method**: Choose one:
     - **Repository**: If you have files in a Git repo
     - **Web editor**: Paste the docker-compose.yaml content
     - **Upload**: Upload docker-compose.yaml file
     - **Custom template**: Not applicable here

3. **Upload docker-compose.yaml:**
   ```yaml
   version: "3.8"
   
   services:
     n8n:
       build: .
       image: n8n-weave-otel:latest
       container_name: n8n-weave
       restart: always
       ports:
         - "5678:5678"
       volumes:
         - ./n8n_data:/home/node/.n8n
       env_file:
         - .env
       environment:
         - OTEL_SERVICE_NAME=n8n
         - OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
         - OTEL_EXPORTER_OTLP_ENDPOINT=${WEAVE_OTLP_ENDPOINT}
         - DEBUG_OTEL=${DEBUG_OTEL:-false}
         - N8N_PROXY_HOPS=1
       networks:
         - n8n-net
   
     cloudflared:
       image: cloudflare/cloudflared:latest
       restart: always
       command: tunnel run n8n-tunnel
       volumes:
         - ./cloudflared:/etc/cloudflared
       networks:
         - n8n-net
       depends_on:
         - n8n
   
   networks:
     n8n-net:
       driver: bridge
   ```

4. **Configure Environment Variables:**
   - Portainer will automatically use `.env` file if present in the same directory
   - **OR** add environment variables manually in the Portainer UI:
     - Click **Environment variables** → **Add variable**
     - Add each variable from `.env`:
       - `WEAVE_OTLP_ENDPOINT`
       - `WANDB_API_KEY`
       - `WANDB_PROJECT_ID`
       - `DEBUG_OTEL`

5. **Configure Volumes:**
   - Ensure `n8n_data` directory exists on host: `mkdir -p /path/to/n8n-weave/n8n_data`
   - Or use Portainer volume management

6. **Deploy:**
   - Click **Deploy the stack**
   - Wait for containers to start

### Step 6: Verify Deployment

1. **Check Stack Status:**
   - In Portainer, go to **Stacks** → **n8n-weave**
   - Verify both `n8n-weave` and `cloudflared` containers are running (green status)

2. **View Logs:**
   - Click on **n8n-weave** container
   - Go to **Logs** tab
   - Look for initialization messages:
     ```
     [OTEL] Starting Weave hybrid trace bootstrap
     [OTEL] Export endpoint: https://...
     [OTEL] Tracing started for service=n8n
     ```

3. **Access n8n UI:**
   - Local: `http://your-host-ip:5678`
   - Cloudflare tunnel: `https://your-hostname.cloudflare.com` (if configured)

4. **Verify OpenTelemetry:**
   - Check logs for successful trace export
   - Visit Weave dashboard: `https://wandb.ai/<entity>/<project>/weave/traces`
   - You should see traces appearing

---

## Method 2: Custom Container from Image

If you've already built the image and pushed it to a registry (Docker Hub, GitHub Container Registry, etc.), you can deploy it directly.

### Step 1: Build and Push Image (if not already done)

```bash
# Build image
docker build -t n8n-weave-otel:latest .

# Tag for registry (replace with your registry)
docker tag n8n-weave-otel:latest your-registry/n8n-weave-otel:latest

# Push to registry
docker push your-registry/n8n-weave-otel:latest
```

### Step 2: Deploy via Portainer

1. **Go to Containers:**
   - Navigate to **Containers** → **Add container**

2. **Configure Container:**
   - **Name**: `n8n-weave`
   - **Image**: `your-registry/n8n-weave-otel:latest` (or `n8n-weave-otel:latest` if built locally)
   - **Always pull the image**: Enable if using remote registry

3. **Network Settings:**
   - **Network**: Create new network `n8n-net` (bridge driver)
   - Or use existing network

4. **Port Mapping:**
   - Click **Publish a new network port**
   - **Host**: `5678`
   - **Container**: `5678`
   - **Protocol**: TCP

5. **Volumes:**
   - Click **map additional volume**
   - **Container**: `/home/node/.n8n`
   - **Host**: `/path/on/host/n8n_data` (create directory first)

6. **Environment Variables:**
   - Click **Environment** → **Add environment variable**
   - Add each variable:
     - `WANDB_API_KEY` = `your_api_key`
     - `WANDB_PROJECT_ID` = `entity/project`
     - `WEAVE_OTLP_ENDPOINT` = `https://collector.weave.example/v1/traces`
     - `OTEL_SERVICE_NAME` = `n8n`
     - `OTEL_EXPORTER_OTLP_PROTOCOL` = `http/protobuf`
     - `OTEL_EXPORTER_OTLP_ENDPOINT` = `${WEAVE_OTLP_ENDPOINT}` (same as WEAVE_OTLP_ENDPOINT)
     - `DEBUG_OTEL` = `true`
     - `N8N_PROXY_HOPS` = `1`

7. **Restart Policy:**
   - Set to **Always**

8. **Deploy:**
   - Click **Deploy the container**

### Step 3: Deploy Cloudflared (Optional)

If you need Cloudflare tunnel:

1. **Add Another Container:**
   - Go to **Containers** → **Add container**

2. **Configure:**
   - **Name**: `cloudflared`
   - **Image**: `cloudflare/cloudflared:latest`
   - **Network**: Same `n8n-net` network

3. **Command:**
   - **Command**: `tunnel run n8n-tunnel`

4. **Volumes:**
   - **Container**: `/etc/cloudflared`
   - **Host**: `/path/on/host/cloudflared` (with `n8n-tunnel.json` and `config.yml`)

5. **Restart Policy:**
   - Set to **Always**

6. **Deploy**

---

## Method 3: Build & Deploy via Portainer

Portainer can build Docker images directly from your Dockerfile.

### Step 1: Prepare Build Context

You need to provide Portainer with all the files needed to build:

Required files:
- `Dockerfile`
- `docker-entrypoint.sh`
- `tracing.js`
- `n8n-otel-instrumentation.js`

**Option A: Upload Files to Portainer Host**
```bash
# Create a directory
mkdir -p /path/to/build-context
cd /path/to/build-context

# Copy all files
cp Dockerfile docker-entrypoint.sh tracing.js n8n-otel-instrumentation.js /path/to/build-context
```

**Option B: Use Git Repository**
- Portainer can build from a Git repository URL

### Step 2: Build Image in Portainer

1. **Go to Images:**
   - Navigate to **Images** → **Build a new image**

2. **Choose Build Method:**
   - **Upload**: Upload Dockerfile and files
   - **Git repository**: Provide Git repo URL and path to Dockerfile

3. **Configure Build:**
   - **Image name**: `n8n-weave-otel:latest`
   - **Build options**: (leave default or customize)
   - Upload all required files or provide Git URL

4. **Build:**
   - Click **Build the image**
   - Wait for build to complete

### Step 3: Deploy Container

Follow the same steps as **Method 2**, using the newly built image.

---

## 🔧 Configuration Reference

### Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `WANDB_API_KEY` | Weights & Biases API key | `your_api_key_here` |
| `WANDB_PROJECT_ID` | W&B entity/project ID | `username/my-project` |
| `WEAVE_OTLP_ENDPOINT` | Weave OTLP endpoint URL | `https://collector.weave.example/v1/traces` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Same as `WEAVE_OTLP_ENDPOINT` | (auto-set from env file) |
| `OTEL_SERVICE_NAME` | Service name for traces | `n8n` |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | OTLP protocol | `http/protobuf` |
| `DEBUG_OTEL` | Enable debug logging | `true` or `false` |
| `N8N_PROXY_HOPS` | Proxy hops config | `1` |

### Volume Mounts

| Container Path | Host Path | Description |
|----------------|-----------|-------------|
| `/home/node/.n8n` | `./n8n_data` | n8n data persistence (workflows, DB, config) |
| `/etc/cloudflared` | `./cloudflared` | Cloudflare tunnel config (optional) |

### Port Mappings

| Host Port | Container Port | Service |
|-----------|----------------|---------|
| `5678` | `5678` | n8n web UI and API |

### Network Configuration

- **Network Type**: Bridge
- **Network Name**: `n8n-net` (custom network for service communication)

---

## 🧪 Verification & Testing

### 1. Check Container Status

In Portainer:
- **Stacks** → **n8n-weave** → Verify all containers are running
- **Containers** → Check `n8n-weave` container status is green

### 2. View Logs

In Portainer:
- Click on **n8n-weave** container
- Go to **Logs** tab
- Look for:
  ```
  [OTEL] Starting Weave hybrid trace bootstrap
  [OTEL] Export endpoint: https://...
  [OTEL] Tracing started for service=n8n
  [entrypoint] OTEL headers prepared for Weave endpoint
  ```

### 3. Test Workflow Execution

#### Option A: Via n8n UI
1. Access n8n at `http://your-host:5678`
2. Create a workflow with an AI node (OpenAI, Anthropic, etc.)
3. Execute the workflow
4. Check Weave dashboard for traces

#### Option B: Via CLI (from Portainer host)

```bash
# Get container name
docker ps | grep n8n-weave

# Execute workflow
docker exec -it n8n-weave n8n execute --id <WORKFLOW_ID>

# Or trigger via webhook
docker exec n8n-weave curl -X POST http://localhost:5678/webhook/<WEBHOOK_ID>/chat \
  -H "Content-Type: application/json" \
  -d '{"chatInput": "hello world"}'
```

### 4. Verify Traces in Weave

1. Navigate to: `https://wandb.ai/<entity>/<project>/weave/traces`
2. Look for new traces matching your workflow execution
3. Inspect spans for:
   - Workflow name and ID
   - Node executions
   - AI model calls with token usage
   - Input/output data

---

## 🔍 Troubleshooting

### Issue: Container fails to start

**Check:**
1. Environment variables are set correctly in Portainer
2. Volume paths exist on host (create `n8n_data` directory)
3. Port 5678 is not already in use: `netstat -tuln | grep 5678`
4. Container logs in Portainer → **Logs** tab

**Fix:**
- Verify all required environment variables are set
- Ensure volumes are properly mounted
- Check for port conflicts

### Issue: Traces not appearing in Weave

**Check:**
1. `WANDB_API_KEY` is correct
2. `WANDB_PROJECT_ID` format is `entity/project`
3. `WEAVE_OTLP_ENDPOINT` is accessible from container
4. Debug logs show successful export: `DEBUG_OTEL=true`

**Fix:**
- Verify credentials in Portainer environment variables
- Enable debug mode: `DEBUG_OTEL=true`
- Check network connectivity from container:
  ```bash
  docker exec n8n-weave wget -O- $WEAVE_OTLP_ENDPOINT
  ```

### Issue: Cloudflare tunnel not working

**Check:**
1. `cloudflared/n8n-tunnel.json` exists and is valid
2. `cloudflared/config.yml` has correct hostname
3. Both containers are on same network (`n8n-net`)

**Fix:**
- Verify tunnel credentials JSON file
- Check tunnel logs in Portainer
- Ensure `cloudflared` container can reach `n8n` container

### Issue: Image build fails in Portainer

**Check:**
1. All required files are uploaded (Dockerfile, entrypoint, tracing scripts)
2. Dockerfile syntax is correct
3. Build logs show specific errors

**Fix:**
- Verify all files are in build context
- Check Dockerfile for errors
- Review build logs in Portainer

---

## 📝 Common Portainer Operations

### Update Environment Variables

1. Go to **Stacks** → **n8n-weave** → **Editor**
2. Modify environment variables in docker-compose.yaml
3. Click **Update the stack**

Or for individual containers:
1. **Containers** → **n8n-weave** → **Duplicate/Edit**
2. Update environment variables
3. **Deploy the container** (will recreate)

### Update Image

1. Rebuild image (if custom):
   ```bash
   docker build -t n8n-weave-otel:latest .
   ```
2. In Portainer:
   - **Stacks** → **n8n-weave** → **Editor**
   - Update image tag if needed
   - **Update the stack**

### View Container Logs

1. **Containers** → **n8n-weave** → **Logs** tab
2. Filter by keyword: Use search box
3. Download logs: Click download icon

### Access Container Shell

1. **Containers** → **n8n-weave** → **Console** tab
2. Choose shell: `sh` or `bash`
3. Click **Connect**

### Backup n8n Data

1. **Volumes** → Find volume or host path
2. Or from host:
   ```bash
   tar -czf n8n_backup_$(date +%Y%m%d).tar.gz /path/to/n8n_data
   ```

### Restart Services

1. **Stacks** → **n8n-weave** → **Actions** → **Restart**
2. Or individual containers: **Containers** → **n8n-weave** → **Restart**

---

## 🔐 Security Considerations

1. **Environment Variables:**
   - Never commit `.env` file to Git
   - Use Portainer secrets for sensitive values (Enterprise feature)
   - Rotate `WANDB_API_KEY` regularly

2. **Network Security:**
   - Use Cloudflare tunnel for external access (recommended)
   - Or restrict port 5678 access with firewall rules
   - Use reverse proxy (Nginx/Traefik) with SSL if exposing directly

3. **Volume Permissions:**
   - Ensure `n8n_data` directory has correct permissions
   - Container runs as `node` user (UID 1000)

---

## 📚 Additional Resources

- [n8n Documentation](https://docs.n8n.io/)
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Weights & Biases Weave](https://wandb.ai/weave)
- [Weave OTLP Integration Guide](https://docs.wandb.ai/weave/guides/tracking/otel)
- [Portainer Documentation](https://docs.portainer.io/)
- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)

---

## ✅ Deployment Checklist

- [ ] Prerequisites met (Docker, Portainer, W&B account)
- [ ] Project files cloned/uploaded to Portainer host
- [ ] `.env` file configured with W&B credentials
- [ ] Docker image built (`n8n-weave-otel:latest`)
- [ ] Stack/container deployed in Portainer
- [ ] All containers running (green status)
- [ ] n8n UI accessible at `http://host:5678`
- [ ] OpenTelemetry logs show successful initialization
- [ ] Test workflow executed
- [ ] Traces visible in Weave dashboard
- [ ] Cloudflare tunnel configured (if needed)

---

**Need Help?** Check the main [README.md](./README.md) for more details or open an issue in the repository.


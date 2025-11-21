# Deployment Analysis: n8n-weave → Portainer

## 📊 Quick Summary

This analysis provides insights into deploying your **n8n-weave** (custom n8n with Weights & Biases Weave observability) into an existing n8n setup using Portainer.

## 🎯 Deployment Scenarios

### Scenario 1: Fresh Deployment (Recommended)
**Best for:** New setup or replacing existing n8n instance

**Approach:** Deploy as a new stack/container using Method 1 (Docker Compose Stack)

**Steps:**
1. Build custom image: `n8n-weave-otel:latest`
2. Deploy via Portainer Docker Compose stack
3. Configure environment variables
4. Access at `http://host:5678`

**Pros:**
- Clean deployment
- All features enabled from start
- Easy to manage via Portainer

**Cons:**
- Need to migrate existing workflows (if any)

---

### Scenario 2: Upgrade Existing n8n Instance
**Best for:** Adding observability to running n8n

**Considerations:**

#### Option A: Side-by-Side Deployment
- Keep existing n8n running on different port
- Deploy new n8n-weave on port 5678
- Gradually migrate workflows

#### Option B: Replace Existing Instance
1. **Backup existing n8n:**
   ```bash
   # Backup volumes
   docker exec <existing-n8n> tar -czf /tmp/n8n_backup.tar.gz /home/node/.n8n
   docker cp <existing-n8n>:/tmp/n8n_backup.tar.gz ./n8n_backup.tar.gz
   ```

2. **Stop existing n8n** (in Portainer or via CLI)

3. **Deploy n8n-weave** using same volume path:
   - Point `n8n_data` volume to your existing n8n data directory
   - This preserves workflows, credentials, and settings

4. **Verify migration:**
   - Check workflows appear in new instance
   - Verify credentials are intact
   - Test workflow execution

**Note:** Both instances can share the same data directory if they're not running simultaneously.

---

## 🔧 Integration Points

### 1. Portainer Stack Deployment
**Compatibility:** ✅ Full support

Portainer's Docker Compose stack feature perfectly supports this deployment:

- ✅ Environment variables via `.env` file
- ✅ Volume mounts for persistent data
- ✅ Network configuration (custom bridge network)
- ✅ Multi-service orchestration (n8n + cloudflared)

**Recommended Method:** Use Portainer's **Stacks** → **Add Stack** with `docker-compose.yaml`

---

### 2. Existing n8n Data Migration

If you have an existing n8n instance:

#### Identify Existing Volume
```bash
# Find existing n8n container
docker ps | grep n8n

# Inspect container to find volume
docker inspect <container-id> | grep -A 10 Mounts
```

#### Migration Paths

**Path 1: Use Same Volume** (Recommended for upgrade)
- Point new n8n-weave container to existing volume path
- In Portainer, set volume mount to your existing n8n data directory
- Example: `/var/lib/docker/volumes/<existing-volume>/_data:/home/node/.n8n`

**Path 2: Copy Data**
```bash
# On Portainer host
# Stop existing n8n
docker stop <existing-n8n-container>

# Copy data
cp -r /path/to/existing/n8n_data/* /path/to/new/n8n_data/

# Deploy n8n-weave pointing to new location
# Start new container
```

**Path 3: Export/Import Workflows**
- Export workflows from existing n8n UI
- Import into new n8n-weave instance
- Manual but safest for testing

---

### 3. Network Configuration

Your deployment uses a custom bridge network (`n8n-net`). This is important if:

- **Cloudflare tunnel** needs to communicate with n8n
- **Multiple services** need to communicate
- **Isolation** from other containers

**Portainer Handling:**
- Portainer automatically creates the network when deploying the stack
- Both containers will be on `n8n-net`
- External access via port mapping (5678) or Cloudflare tunnel

---

### 4. Environment Variables Management

**Portainer Options:**

#### Option A: `.env` File (Recommended)
- Create `.env` in stack directory
- Portainer automatically reads it when deploying stack
- Easy to manage and version control

#### Option B: Portainer Environment Variables
- Manually add each variable in Portainer UI
- Good for UI-based management
- Can use Portainer secrets (Enterprise feature)

#### Option C: Docker Secrets (Enterprise)
- Store sensitive values as secrets
- More secure for production

**Recommended:** Use `.env` file with Portainer stack deployment for simplicity.

---

## 🔐 Security Considerations

### 1. API Keys
- ✅ **Never commit** `.env` to Git
- ✅ Use Portainer secrets for sensitive values (Enterprise)
- ✅ Rotate `WANDB_API_KEY` regularly
- ✅ Restrict access to Portainer UI

### 2. Network Security
- **Cloudflare Tunnel** (recommended): No open ports needed
- **Direct Port Exposure**: Use firewall rules to restrict access
- **Reverse Proxy**: Nginx/Traefik with SSL in front of n8n

### 3. Volume Permissions
- Container runs as `node` user (UID 1000)
- Ensure host directory has correct permissions:
  ```bash
  sudo chown -R 1000:1000 /path/to/n8n_data
  ```

---

## 📦 Build Requirements

### Custom Image Dependencies

Your `Dockerfile` extends `n8n:latest` and adds:

1. **OpenTelemetry packages** (installed globally)
2. **Custom scripts:**
   - `docker-entrypoint.sh` - W&B auth setup
   - `tracing.js` - OpenTelemetry bootstrap
   - `n8n-otel-instrumentation.js` - n8n patching

**Build Time:** ~5-10 minutes (depends on network speed)

**Build Context Required Files:**
- `Dockerfile`
- `docker-entrypoint.sh`
- `tracing.js`
- `n8n-otel-instrumentation.js`

**Portainer Build Options:**
1. Build on host: `docker build -t n8n-weave-otel:latest .`
2. Build in Portainer: Use **Images** → **Build a new image**
3. Use pre-built image from registry (if you push it)

---

## 🚀 Recommended Deployment Flow

### Step-by-Step for Portainer

1. **Prepare Host:**
   ```bash
   # Clone or upload project files
   git clone <repo> /opt/n8n-weave
   cd /opt/n8n-weave
   ```

2. **Configure:**
   ```bash
   # Create .env
   cp .env.example .env
   nano .env  # Fill in W&B credentials
   ```

3. **Build Image:**
   ```bash
   # Option A: Build on host
   docker build -t n8n-weave-otel:latest .
   
   # Option B: Build via Portainer
   # (see PORTAINER_DEPLOYMENT.md)
   ```

4. **Deploy in Portainer:**
   - Go to **Stacks** → **Add Stack**
   - Name: `n8n-weave`
   - Upload `docker-compose.yaml` or paste content
   - Portainer will read `.env` automatically
   - Click **Deploy**

5. **Verify:**
   - Check containers are running (green status)
   - View logs for OpenTelemetry initialization
   - Access n8n UI at `http://host:5678`

6. **Test:**
   - Create a workflow with AI node
   - Execute workflow
   - Check Weave dashboard for traces

---

## 🔄 Integration with Existing Infrastructure

### If You Have:

#### Existing Reverse Proxy (Nginx/Traefik)
- Point proxy to `http://n8n:5678` (container name) or `http://localhost:5678`
- Keep n8n-weave on internal network
- Access via reverse proxy domain

#### Existing Monitoring (Prometheus/Grafana)
- Add n8n container to monitoring targets
- Metrics available via n8n's built-in endpoints

#### Existing Log Aggregation (ELK/Loki)
- n8n logs available via Docker logs
- Forward to your log aggregator
- OpenTelemetry traces go to Weave

#### Existing Backup Solution
- Include `n8n_data` volume in backup schedule
- Backup includes workflows, credentials, DB

---

## ⚠️ Important Notes

1. **Port Conflict:**
   - Default port is `5678`
   - If existing n8n uses this, change in `docker-compose.yaml`:
     ```yaml
     ports:
       - "5679:5678"  # Host:Container
     ```

2. **Volume Paths:**
   - Use **absolute paths** for volumes in Portainer if not using stack directory
   - Relative paths work if deploying from stack directory

3. **Cloudflare Tunnel (Optional):**
   - Only needed for external webhook access
   - Can be disabled if only accessing internally
   - Comment out `cloudflared` service in compose file

4. **Environment Variable Precedence:**
   - `docker-compose.yaml` environment section
   - `.env` file
   - System environment variables
   - Portainer environment variables (if set)

5. **Updating Deployment:**
   - Rebuild image when code changes
   - Update stack in Portainer
   - Restart containers to pick up changes

---

## 📊 Resource Requirements

**Minimum Resources:**
- CPU: 1 core
- RAM: 1GB
- Disk: 5GB (for n8n data)

**Recommended Resources:**
- CPU: 2 cores
- RAM: 2GB
- Disk: 10GB+

**Network:**
- Outbound HTTPS to Weave OTLP endpoint
- Inbound HTTP on port 5678 (or via Cloudflare tunnel)

---

## ✅ Deployment Checklist

- [ ] Portainer installed and accessible
- [ ] Docker and Docker Compose available
- [ ] Project files on Portainer host
- [ ] `.env` configured with W&B credentials
- [ ] Docker image built (`n8n-weave-otel:latest`)
- [ ] Volume directory created (`n8n_data`)
- [ ] Port 5678 available (or configured alternate)
- [ ] Stack/container deployed in Portainer
- [ ] Containers running (green status)
- [ ] OpenTelemetry logs show initialization
- [ ] n8n UI accessible
- [ ] Test workflow executed
- [ ] Traces visible in Weave dashboard
- [ ] Cloudflare tunnel configured (if needed)
- [ ] Backup strategy in place

---

## 🆘 Quick Troubleshooting

| Issue | Quick Fix |
|-------|-----------|
| Container won't start | Check environment variables in Portainer |
| No traces in Weave | Verify `WANDB_API_KEY` and `WANDB_PROJECT_ID` |
| Port already in use | Change port mapping in `docker-compose.yaml` |
| Permission denied | Fix volume permissions: `chown -R 1000:1000 n8n_data` |
| Can't access n8n UI | Check port mapping and firewall rules |
| Cloudflare tunnel fails | Verify tunnel credentials JSON exists |

---

## 📚 Next Steps

1. **Read** [PORTAINER_DEPLOYMENT.md](./PORTAINER_DEPLOYMENT.md) for detailed deployment steps
2. **Review** [README.md](./README.md) for general project information
3. **Check** [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) for technical details
4. **Deploy** using your preferred method from the guide
5. **Test** with a simple workflow
6. **Monitor** traces in Weave dashboard

---

**Questions or Issues?** 
- Check the troubleshooting sections in the guides
- Review container logs in Portainer
- Verify environment variables are set correctly
- Ensure all prerequisites are met


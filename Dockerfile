# --- n8n + OpenTelemetry + Weave hybrid instrumentation ---
FROM docker.n8n.io/n8nio/n8n:latest

USER root
WORKDIR /usr/local/lib/node_modules/n8n

# Entrypoint script and calculate Weave headers
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]


# Install OpenTelemetry + OpenInference helpers globally to avoid workspace conflicts
RUN npm install -g \
  @opentelemetry/api \
  @opentelemetry/sdk-node \
  @opentelemetry/sdk-trace-base \
  @opentelemetry/sdk-trace-node \
  @opentelemetry/sdk-logs \
  @opentelemetry/context-async-hooks \
  @opentelemetry/auto-instrumentations-node \
  @opentelemetry/exporter-trace-otlp-proto \
  @opentelemetry/exporter-logs-otlp-proto \
  @opentelemetry/resources \
  @opentelemetry/semantic-conventions \
  @opentelemetry/instrumentation \
  @arizeai/openinference-semantic-conventions \
  flat \
  winston 

# Copy tracing + instrumentation scripts
COPY tracing.js n8n-otel-instrumentation.js ./
RUN chown node:node *.js

USER node

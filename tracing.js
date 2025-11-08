"use strict";

/**
 * n8n + Weave Hybrid OpenTelemetry Bootstrap
 * - Sends OTEL traces/logs to Weave
 * - Adds AI-aware attributes (gen_ai.*)
 * - Debug + graceful shutdown
 */

const { AsyncHooksContextManager } = require("@opentelemetry/context-async-hooks");
const { context, trace, diag, DiagConsoleLogger, DiagLogLevel } = require("@opentelemetry/api");
const opentelemetry = require("@opentelemetry/sdk-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
const { OTLPLogExporter } = require("@opentelemetry/exporter-logs-otlp-http");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { registerInstrumentations } = require("@opentelemetry/instrumentation");
const { Resource } = require("@opentelemetry/resources");
const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions");
const setupN8nOpenTelemetry = require("./n8n-otel-instrumentation");
const winston = require("winston");
const https = require("https");

const DEBUG = process.env.DEBUG_OTEL === "true";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "n8n";
const OTLP_URL = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const RAW_HEADERS = process.env.OTEL_EXPORTER_OTLP_HEADERS || "";
const headers = {};

for (const pair of RAW_HEADERS.split(",")) {
  const [k, v] = pair.split("=");
  if (k && v) headers[k.trim()] = v.trim();
}

diag.setLogger(new DiagConsoleLogger(), DEBUG ? DiagLogLevel.DEBUG : DiagLogLevel.ERROR);

const logger = winston.createLogger({
  level: DEBUG ? "debug" : "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

if (DEBUG) {
  logger.debug(`[OTEL] Starting Weave hybrid trace bootstrap`);
  logger.debug(`[OTEL] Export endpoint: ${OTLP_URL}`);
  logger.debug(`[OTEL] Headers: ${JSON.stringify(headers)}`);
}

context.setGlobalContextManager(new AsyncHooksContextManager().enable());

registerInstrumentations({
  instrumentations: [
    getNodeAutoInstrumentations({
      "@opentelemetry/instrumentation-fs": { enabled: false },
      "@opentelemetry/instrumentation-dns": { enabled: false },
      "@opentelemetry/instrumentation-net": { enabled: false },
      "@opentelemetry/instrumentation-tls": { enabled: false },
      "@opentelemetry/instrumentation-pg": { enhancedDatabaseReporting: true },
    }),
  ],
});

setupN8nOpenTelemetry();

let traceExporter, logExporter;
try {
  traceExporter = new OTLPTraceExporter({ url: OTLP_URL, headers, timeoutMillis: 10000 });
  logExporter = new OTLPLogExporter({ url: OTLP_URL, headers, timeoutMillis: 10000 });
  logger.info("[OTEL] Exporters initialized for Weave");
} catch (e) {
  logger.error("[OTEL] Failed to init exporters", e);
}

const sdk = new opentelemetry.NodeSDK({
  resource: new Resource({ [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME }),
  traceExporter,
  logRecordProcessors: [new opentelemetry.logs.SimpleLogRecordProcessor(logExporter)],
});

sdk.start()
  .then(() => logger.info(`[OTEL] Tracing started for service=${SERVICE_NAME}`))
  .catch((err) => logger.error("[OTEL] SDK start failed", err));

async function shutdown(reason) {
  logger.info(`[OTEL] Shutting down (${reason})`);
  try {
    await sdk.shutdown();
    logger.info("[OTEL] Telemetry flushed");
  } catch (e) {
    logger.error("[OTEL] Flush error", e);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  logger.error("[OTEL] Uncaught exception", err);
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(err);
    span.setStatus({ code: 2, message: err.message || String(err) });
  }
  shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => logger.error("[OTEL] Unhandled rejection", reason));

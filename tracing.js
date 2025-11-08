"use strict";

/**
 * n8n + Weave Hybrid OpenTelemetry Bootstrap
 * - Sends OTEL traces/logs to Weave
 * - Adds AI-aware attributes (gen_ai.*)
 * - Debug + graceful shutdown
 */

const { AsyncHooksContextManager } = require("@opentelemetry/context-async-hooks");
const { context, trace, diag, DiagConsoleLogger, DiagLogLevel, SpanStatusCode, SpanKind } = require("@opentelemetry/api");
const opentelemetry = require("@opentelemetry/sdk-node");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto");
const { OTLPLogExporter } = require("@opentelemetry/exporter-logs-otlp-proto");
const { getNodeAutoInstrumentations } = require("@opentelemetry/auto-instrumentations-node");
const { registerInstrumentations } = require("@opentelemetry/instrumentation");
const { Resource } = require("@opentelemetry/resources");
const { SemanticResourceAttributes } = require("@opentelemetry/semantic-conventions");
const setupN8nOpenTelemetry = require("./n8n-otel-instrumentation");
const winston = require("winston");
const https = require("https");
const childProcess = require("child_process");

const DEBUG = process.env.DEBUG_OTEL === "true";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "n8n";
const OTLP_URL = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const WANDB_API_KEY = process.env.WANDB_API_KEY;
const WANDB_PROJECT_ID = process.env.WANDB_PROJECT_ID;
const PATCH_CHILD_FORK = process.env.PATCH_CHILD_FORK === "true";

// Prepare headers exactly like the working test script
const basicAuth = Buffer.from(`api:${WANDB_API_KEY}`).toString('base64');
const headers = {
  'Authorization': `Basic ${basicAuth}`,
  'project_id': WANDB_PROJECT_ID
};

diag.setLogger(new DiagConsoleLogger(), DEBUG ? DiagLogLevel.DEBUG : DiagLogLevel.ERROR);

if (PATCH_CHILD_FORK) {
  const originalFork = childProcess.fork.bind(childProcess);
  childProcess.fork = function(modulePath, args, options) {
    if (!Array.isArray(args) && args && typeof args === 'object') {
      options = args; args = [];
    }
    if (!args) args = [];
    if (!options) options = {};

    const preloadPath = "/usr/local/lib/node_modules/n8n/tracing.js";
    const baseExecArgv = Array.isArray(options.execArgv) ? options.execArgv.slice() : process.execArgv.slice();
    const hasPreload = baseExecArgv.some((v, i) => (
      (v === '-r' || v === '--require') && baseExecArgv[i+1] === preloadPath
    )) || baseExecArgv.includes(`-r=${preloadPath}`) || baseExecArgv.includes(`--require=${preloadPath}`);
    const execArgv = hasPreload ? baseExecArgv : baseExecArgv.concat(["-r", preloadPath]);

    const env = { ...process.env, ...(options.env || {}) };

    if (DEBUG) {
      try { console.log("[OTEL] child_process.fork patched", { modulePath, execArgv, hasPreload }); } catch (_) {}
    }
    return originalFork(modulePath, args, { ...options, execArgv, env });
  };
}

const logger = winston.createLogger({
  level: DEBUG ? "debug" : "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

if (DEBUG) {
  logger.debug(`[OTEL] Starting Weave hybrid trace bootstrap`);
  logger.debug(`[OTEL] Export endpoint: ${OTLP_URL}`);
  logger.debug(`[OTEL] Project ID: ${WANDB_PROJECT_ID}`);
  logger.debug(`[OTEL] API Key: ${WANDB_API_KEY ? WANDB_API_KEY.substring(0, 8) + '...' : 'MISSING'}`);
}

// Only set context manager if not already set
try {
  const currentManager = context.getGlobalContextManager();
  if (currentManager && currentManager.constructor.name === 'NoopContextManager') {
    context.setGlobalContextManager(new AsyncHooksContextManager().enable());
  }
} catch (e) {
  // If getting current manager fails, set it
  context.setGlobalContextManager(new AsyncHooksContextManager().enable());
}

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
  logger.debug(`[OTEL] Initializing exporters with endpoint: ${OTLP_URL}`);
  logger.debug(`[OTEL] Using headers: ${JSON.stringify({
    'Authorization': `Basic ${basicAuth.substring(0, 20)}...`,
    'project_id': WANDB_PROJECT_ID
  })}`);
  
  traceExporter = new OTLPTraceExporter({ 
    url: OTLP_URL, 
    headers: headers, 
    timeoutMillis: 10000 
  });
  logExporter = new OTLPLogExporter({ 
    url: OTLP_URL, 
    headers: headers, 
    timeoutMillis: 10000 
  });
  logger.info("[OTEL] Exporters initialized for Weave");
} catch (e) {
  logger.error("[OTEL] Failed to init exporters", e);
  logger.error(`[OTEL] Endpoint used: ${OTLP_URL}`);
  logger.error(`[OTEL] Headers used: ${JSON.stringify({
    'Authorization': `Basic ${basicAuth.substring(0, 20)}...`,
    'project_id': WANDB_PROJECT_ID
  })}`);
}

const sdk = new opentelemetry.NodeSDK({
  resource: new Resource({ [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME }),
  traceExporter,
  logRecordProcessors: [new opentelemetry.logs.SimpleLogRecordProcessor(logExporter)],
});

try {
  const startResult = sdk.start();
  if (startResult && typeof startResult.then === 'function') {
    startResult
      .then(() => {
        logger.info(`[OTEL] Tracing started for service=${SERVICE_NAME}`);
        // Send a test trace to verify Weave connection
        sendTestTrace();
      })
      .catch((err) => logger.error("[OTEL] SDK start failed", err));
  } else {
    logger.info(`[OTEL] Tracing started for service=${SERVICE_NAME}`);
    // Send a test trace to verify Weave connection
    sendTestTrace();
  }
} catch (err) {
  logger.error("[OTEL] SDK initialization failed", err);
}

function sendTestTrace() {
  logger.debug(`[OTEL] Sending test trace with headers: ${JSON.stringify({
    'Authorization': `Basic ${basicAuth.substring(0, 20)}...`,
    'project_id': WANDB_PROJECT_ID
  })}`);
  logger.debug(`[OTEL] Using endpoint: ${OTLP_URL}`);
  
  const tracer = trace.getTracer('weave-test');
  const span = tracer.startSpan('weave-connection-test', {
    kind: SpanKind.INTERNAL,
    attributes: {
      'test.type': 'connection-verification',
      'service.name': SERVICE_NAME,
      'weave.project_id': WANDB_PROJECT_ID,
      'test.endpoint': OTLP_URL,
      'test.timestamp': new Date().toISOString(),
      'test.runtime': 'nodejs',
      'test.exporter': 'otlp-proto',
      'test.auth_method': 'basic'
    }
  });
  
  span.addEvent('Testing Weave connection', {
    'test.runtime': 'nodejs',
    'test.exporter': 'otlp-proto',
    'test.auth_method': 'basic'
  });
  
  span.setStatus({ 
    code: SpanStatusCode.OK, 
    message: 'Test trace sent successfully' 
  });
  span.end();
  
  logger.info('[OTEL] Test trace sent to Weave - check your Weave dashboard');
}

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

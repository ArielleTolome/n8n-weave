const { trace, context, SpanStatusCode, SpanKind } = require("@opentelemetry/api");
const flat = require("flat");
const DEBUG = process.env.DEBUG_OTEL === "true";

function setupN8nOpenTelemetry() {
  try {
    const { WorkflowExecute } = require("n8n-core");
    if (DEBUG) {
      console.log("[OTEL] Applying n8n OpenTelemetry instrumentation");
      try { console.log("[OTEL] n8n-core resolved at", require.resolve("n8n-core")); } catch (_) {}
    }

    const originalProcessRun = WorkflowExecute.prototype.processRunExecutionData;
    WorkflowExecute.prototype.processRunExecutionData = function (workflow) {
      const tracer = trace.getTracer("n8n-instrumentation", "1.0.0");
      const wfData = workflow || {};
      const wfAttrs = {
        "n8n.workflow.id": wfData.id ?? "",
        "n8n.workflow.name": wfData.name ?? "",
        ...flat(wfData.settings ?? {}, { delimiter: ".", transformKey: (k) => `n8n.workflow.settings.${k}` }),
      };
      if (DEBUG) {
        try { console.log("[OTEL] processRunExecutionData invoked", wfAttrs); } catch (_) {}
      }

      const span = tracer.startSpan("n8n.workflow.execute", {
        attributes: wfAttrs,
        kind: SpanKind.INTERNAL,
      });
      if (DEBUG) {
        try { console.log("[OTEL] workflow span started", { recording: span.isRecording() }); } catch (_) {}
      }

      const active = trace.setSpan(context.active(), span);
      return context.with(active, () => {
        const cancelable = originalProcessRun.apply(this, arguments);
        cancelable
          .then(
            (result) => {
              if (result?.data?.resultData?.error) {
                const err = result.data.resultData.error;
                span.recordException(err);
                span.setStatus({ code: SpanStatusCode.ERROR, message: String(err.message || err) });
              }
            },
            (error) => {
              span.recordException(error);
              span.setStatus({ code: SpanStatusCode.ERROR, message: String(error.message || error) });
            }
          )
          .finally(() => span.end());
        return cancelable;
      });
    };

    const originalRunNode = WorkflowExecute.prototype.runNode;
    WorkflowExecute.prototype.runNode = async function (
      workflow,
      executionData,
      runExecutionData,
      runIndex,
      additionalData,
      mode,
      abortSignal
    ) {
      const tracer = trace.getTracer("n8n-instrumentation", "1.0.0");
      const node = executionData?.node ?? {};
      const nodeType = node.type?.toLowerCase() || "unknown";

      const attrs = {
        "n8n.workflow.id": workflow?.id ?? "unknown",
        "n8n.node.name": node.name,
        "n8n.node.type": nodeType,
      };
      if (DEBUG) {
        try { console.log("[OTEL] runNode invoked", attrs); } catch (_) {}
      }

      // AI enrichment
      const maybeModel = node.parameters?.model || node.parameters?.modelName;
      const maybePrompt = node.parameters?.prompt || node.parameters?.messages;
      const maybeSystem = (
        nodeType.includes("openai") ? "openai" :
        nodeType.includes("anthropic") ? "anthropic" :
        nodeType.includes("huggingface") ? "huggingface" :
        nodeType.includes("cohere") ? "cohere" :
        nodeType.includes("ollama") ? "ollama" :
        undefined
      );

      if (maybeSystem) {
        attrs["gen_ai.system"] = maybeSystem;
        attrs["gen_ai.request.model"] = maybeModel || "unknown";
        if (maybePrompt) attrs["gen_ai.input.messages"] = JSON.stringify(maybePrompt);
      }

      return tracer.startActiveSpan(
        "n8n.node.execute",
        { attributes: attrs, kind: SpanKind.INTERNAL },
        async (span) => {
          if (DEBUG) {
            try { console.log("[OTEL] node span started", { recording: span.isRecording(), node: node.name }); } catch (_) {}
          }
          try {
            const result = await originalRunNode.apply(this, [workflow, executionData, runExecutionData, runIndex, additionalData, mode, abortSignal]);

            const outputData = result?.data?.[runIndex];
            const finalJson = outputData?.map((i) => i.json);
            if (finalJson) {
              span.setAttribute("n8n.node.output_json", JSON.stringify(finalJson));
              if (maybeSystem) span.setAttribute("gen_ai.output.completion", JSON.stringify(finalJson));
            }

            const usage = outputData?.[0]?.json?.usage;
            if (usage) {
              if (usage.prompt_tokens) span.setAttribute("gen_ai.usage.prompt_tokens", usage.prompt_tokens);
              if (usage.completion_tokens) span.setAttribute("gen_ai.usage.completion_tokens", usage.completion_tokens);
              if (usage.total_tokens) span.setAttribute("gen_ai.usage.total_tokens", usage.total_tokens);
            }

            return result;
          } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: String(error.message || error) });
            throw error;
          } finally {
            span.end();
          }
        }
      );
    };
  } catch (e) {
    console.error("Failed to set up n8n OpenTelemetry instrumentation:", e);
  }
}

module.exports = setupN8nOpenTelemetry;

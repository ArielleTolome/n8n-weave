const { trace, context, SpanStatusCode, SpanKind } = require("@opentelemetry/api");
const flat = require("flat");
const DEBUG = process.env.DEBUG_OTEL === "true";

const sanitizeSpanName = (value, fallback) => {
  const base = (value ?? fallback ?? "").toString().trim();
  if (!base) return fallback ?? "n8n";
  const clean = base.replace(/[^a-zA-Z0-9\-_ ]+/g, "").replace(/\s+/g, "-");
  return clean || (fallback ?? "n8n");
};

const safeJSONStringify = (value) => {
  try {
    return JSON.stringify(value);
  } catch (_) {
    try {
      return String(value);
    } catch (err) {
      return "";
    }
  }
};

const safeInspect = (obj, depth = 6) => {
  const util = require("util");
  try {
    return util.inspect(obj, {
      depth,
      colors: false,
      maxArrayLength: 50,
      maxStringLength: 2000,
      breakLength: 120,
      compact: false,
    });
  } catch (err) {
    return String(err);
  }
};

const summarizeMessages = (messages) => {
  if (!Array.isArray(messages)) return undefined;
  return messages
    .map((msg) => {
      const role = msg?.role ?? "unknown";
      const content = msg?.content;
      if (typeof content === "string") return `${role}: ${content}`;
      if (Array.isArray(content)) {
        const parts = content
          .map((part) => (typeof part === "string" ? part : safeJSONStringify(part)))
          .join(" ");
        return `${role}: ${parts}`;
      }
      return `${role}: ${safeJSONStringify(content)}`;
    })
    .join("\n");
};

const extractUsage = (value, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 6) return undefined;
  if (value.usage && typeof value.usage === "object") return value.usage;
  for (const key of Object.keys(value)) {
    const nested = extractUsage(value[key], depth + 1);
    if (nested) return nested;
  }
  return undefined;
};

const extractModel = (value, seen = new WeakSet(), depth = 0) => {
  if (!value || typeof value !== "object" || depth > 8) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  const modelKeys = ["model", "response_model", "used_model", "model_name"];
  for (const k of modelKeys) {
    const v = value[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }

  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child && typeof child === "object") {
      const nested = extractModel(child, seen, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
};
const aiAugmentations = new Map();

class OpenAISpanCaptureProcessor {
  onStart() {}
  onEnd(span) {
    const scopeName = span.instrumentationScope?.name || span.instrumentationLibrary?.name;
    if (!scopeName || !scopeName.toLowerCase().includes("openai")) return;
    if (!span.parentSpanId) return;

    const attrs = span.attributes || {};
    const data = aiAugmentations.get(span.parentSpanId) || {};

    const keysToCopy = [
      "gen_ai.system",
      "gen_ai.provider.name",
      "gen_ai.operation.name",
      "gen_ai.request.model",
      "gen_ai.response.model",
      "gen_ai.input.messages",
      "gen_ai.output.messages",
      "gen_ai.system_instructions",
      "gen_ai.output.completion",
      "input.value",
      "output.value",
      "gen_ai.request.max_tokens",
      "gen_ai.request.temperature",
      "gen_ai.request.top_p",
      "gen_ai.request.top_k",
      "gen_ai.request.frequency_penalty",
      "gen_ai.request.presence_penalty",
      "gen_ai.request.stop_sequences",
      "gen_ai.request.choice.count",
      "gen_ai.response.finish_reasons",
      "gen_ai.usage.input_tokens",
      "gen_ai.usage.output_tokens",
      "gen_ai.usage.total_tokens",
    ];

    for (const key of keysToCopy) {
      if (attrs[key] !== undefined && data[key] === undefined) {
        data[key] = attrs[key];
      }
    }

    aiAugmentations.set(span.parentSpanId, data);
  }
  shutdown() {}
  forceFlush() {}
}

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
      const wfName = wfData.name ?? "";
      const wfAttrs = {
        "n8n.workflow.id": wfData.id ?? "",
        "n8n.workflow.name": wfName,
        "n8n.workflow.span_name": sanitizeSpanName(wfName, wfData.id ?? "n8n-workflow"),
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

      let runType = "node";
      if (nodeType.includes("agent")) runType = "llm";
      else if (nodeType.includes("tool")) runType = "tool";
      else if (nodeType.includes("chain")) runType = "chain";
      else if (nodeType.includes("retriever")) runType = "retriever";

      const attrs = {
        "n8n.workflow.id": workflow?.id ?? "unknown",
        "n8n.node.name": node.name,
        "n8n.node.type": nodeType,
      };
      if (DEBUG) {
        try {
          console.log("[OTEL] runNode invoked", {
            ...attrs,
            parameters: node.parameters,
            inputData: executionData?.data,
          });
        } catch (_) {}
      }

      const maybeModel = node.parameters?.model || node.parameters?.modelName;
      const maybePrompt = node.parameters?.prompt;
      const maybeMessages = node.parameters?.messages;
      const maybeSystem = (
        nodeType.includes("openai") ? "openai" :
        nodeType.includes("anthropic") ? "anthropic" :
        nodeType.includes("huggingface") ? "huggingface" :
        nodeType.includes("cohere") ? "cohere" :
        nodeType.includes("ollama") ? "ollama" :
        undefined
      );

      if (!maybeModel && additionalData?.executionData?.contextData?.model) {
        attrs["gen_ai.request.model"] = additionalData.executionData.contextData.model;
      }


      let inputTranscript;

      if (maybeSystem) {
        const operationName = nodeType.includes("chat") ? "chat" : (nodeType.includes("completion") ? "text_completion" : "generate_content");
        attrs["gen_ai.provider.name"] = maybeSystem;
        attrs["gen_ai.system"] = maybeSystem;
        attrs["gen_ai.operation.name"] = operationName;
        if (maybeModel) attrs["gen_ai.request.model"] = maybeModel;
        if (maybePrompt) {
          const promptMessages = [{ role: "user", content: maybePrompt }];
          attrs["gen_ai.input.messages"] = safeJSONStringify(promptMessages);
          inputTranscript = summarizeMessages(promptMessages);
        }
        if (maybeMessages) {
          attrs["gen_ai.input.messages"] = safeJSONStringify(maybeMessages);
          inputTranscript = summarizeMessages(maybeMessages);
        }
        const systemInstructions = node.parameters?.systemMessage || node.parameters?.systemInstruction;
        if (systemInstructions) attrs["gen_ai.system_instructions"] = JSON.stringify(systemInstructions);
        const choiceCount = node.parameters?.numberOfCompletions || node.parameters?.chooseBestResult;
        if (choiceCount) attrs["gen_ai.request.choice.count"] = Number(choiceCount) || choiceCount;
        const maxTokens = node.parameters?.maxTokens || node.parameters?.maxTokenCount;
        if (maxTokens !== undefined) attrs["gen_ai.request.max_tokens"] = Number(maxTokens);
        const temperature = node.parameters?.temperature;
        if (temperature !== undefined) attrs["gen_ai.request.temperature"] = Number(temperature);
        const topP = node.parameters?.topP;
        if (topP !== undefined) attrs["gen_ai.request.top_p"] = Number(topP);
        const topK = node.parameters?.topK;
        if (topK !== undefined) attrs["gen_ai.request.top_k"] = Number(topK);
        const frequencyPenalty = node.parameters?.frequencyPenalty;
        if (frequencyPenalty !== undefined) attrs["gen_ai.request.frequency_penalty"] = Number(frequencyPenalty);
        const presencePenalty = node.parameters?.presencePenalty;
        if (presencePenalty !== undefined) attrs["gen_ai.request.presence_penalty"] = Number(presencePenalty);
        const stopSequences = node.parameters?.stopWords || node.parameters?.stopSequences;
        if (stopSequences) attrs["gen_ai.request.stop_sequences"] = JSON.stringify(stopSequences);
      }

      if (!inputTranscript && maybePrompt) inputTranscript = typeof maybePrompt === "string" ? maybePrompt : safeJSONStringify(maybePrompt);
      if (inputTranscript) attrs["input.value"] = inputTranscript;

      const nodeSpanName = sanitizeSpanName(node.name, nodeType || "n8n-node");
      
      try {
        const inputData = executionData?.data?.main
          ? executionData.data.main.flatMap((arr) => arr.map((i) => i.json))
          : [];

        if (inputData.length) {
          attrs["n8n.node.input_json"] = JSON.stringify(inputData);
          attrs["gen_ai.input.messages"] = JSON.stringify(inputData);
          attrs["input.value"] = JSON.stringify(inputData);
          // // For AI nodes, also treat it as gen_ai.input if no prompt/messages already present
          // if (!attrs["gen_ai.input.messages"]) {
          //   const inputMessages = inputData.map((i) => ({
          //     role: "user",
          //     content: i,
          //   }));

          //   attrs["gen_ai.input.messages"] = safeJSONStringify(inputMessages);
          //   attrs["input.value"] = summarizeMessages(inputMessages);
          // }
        }
      } catch (err) {
        if (DEBUG) {
          console.warn("[OTEL] Failed to capture input_json", err);
        }
      }

      if (DEBUG) {
        console.log("[OTEL] ---- NODE EXECUTION CONTEXT DUMP ----");
        console.log("[OTEL] workflow:", safeInspect(workflow));
        console.log("[OTEL] executionData:", safeInspect(executionData));
        console.log("[OTEL] runExecutionData:", safeInspect(runExecutionData));
        console.log("[OTEL] runIndex:", runIndex);
        console.log("[OTEL] additionalData:", safeInspect(additionalData));
        console.log("[OTEL] mode:", mode);
        // console.log("[OTEL] abortSignal:", abortSignal?.aborted);
        console.log("[OTEL] ------------------------------------");
      }

      return tracer.startActiveSpan(
        nodeSpanName,
        { attributes: attrs, kind: SpanKind.INTERNAL },
        async (span) => {
          if (DEBUG) {
            try { console.log("[OTEL] node span started", { recording: span.isRecording(), node: node.name }); } catch (_) {}
          }
          try {
            const result = await originalRunNode.apply(this, [workflow, executionData, runExecutionData, runIndex, additionalData, mode, abortSignal]);

            const outputData = result?.data?.[runIndex];
            if (DEBUG) {
              try {
                console.log("[OTEL] raw node result", {
                  node: node.name,
                  rawResult: result,
                  outputData: safeJSONStringify(outputData),
                });
              } catch (_) {}
            }
            const finalJson = outputData?.map((i) => i.json);
            if (finalJson) {
              span.setAttribute("n8n.node.output_json", JSON.stringify(finalJson));

              const firstOutput = Array.isArray(finalJson) ? finalJson[0] : finalJson;
              const responseModel = extractModel(firstOutput) || maybeModel;
              if (responseModel) span.setAttribute("gen_ai.response.model", responseModel);
              const finishReasons = firstOutput?.choices?.map((choice) => choice?.finish_reason).filter(Boolean);
              if (finishReasons?.length) span.setAttribute("gen_ai.response.finish_reasons", JSON.stringify(finishReasons));
              const outputMessages = firstOutput?.choices?.map((choice) => choice?.message).filter(Boolean);
              if (outputMessages?.length) span.setAttribute("gen_ai.output.messages", JSON.stringify(outputMessages));

              const outputTranscript = outputMessages ? summarizeMessages(outputMessages) : safeJSONStringify(firstOutput?.choices?.[0]?.message?.content ?? firstOutput);
              const prettyInput = inputTranscript?.trim?.() || "";
              const prettyOutput = outputTranscript?.trim?.() || "";
              if (prettyInput) span.setAttribute("input.value", prettyInput);
              if (prettyOutput) span.setAttribute("output.value", prettyOutput);
              if (prettyInput && prettyOutput) {
                const combined = `${prettyInput}\n---\n${prettyOutput}`;
                span.setAttribute("gen_ai.conversation", combined);
              }
              if (maybeSystem && prettyOutput) {
                span.setAttribute("gen_ai.output.completion", prettyOutput);
              }

              // --- Build Weave-compatible payload ---
              const weavePayload = {
                inputs: {
                  messages: JSON.parse(attrs["gen_ai.input.messages"] || "[]") || inputData || [],
                },
                outputs: {
                  text:
                    prettyOutput ||
                    (Array.isArray(finalJson) && finalJson.length ? safeJSONStringify(finalJson[0]) : safeJSONStringify(finalJson)),
                },
                usage: extractUsage(finalJson?.[0]) || extractUsage(result),
                extra: {
                  model: attrs["gen_ai.request.model"] || attrs["gen_ai.response.model"] || maybeModel,
                  temperature: node.parameters?.temperature,
                  provider: maybeSystem || "unknown",
                },
                run_type: runType,
                name: node.name || "n8n-node",
              };
              span.setAttribute("input.value", JSON.stringify(weavePayload.inputs, null, 2));
              span.setAttribute("output.value", JSON.stringify(weavePayload.outputs, null, 2));
              span.setAttribute("weave.inputs", JSON.stringify(weavePayload.inputs));
              span.setAttribute("weave.outputs", JSON.stringify(weavePayload.outputs));
              span.setAttribute("weave.usage", JSON.stringify(weavePayload.usage || {}));
              span.setAttribute("weave.metadata", JSON.stringify(weavePayload.extra));
              span.setAttribute("weave.run_type", weavePayload.run_type);
              span.setAttribute("weave.name", weavePayload.name);



                          }

            const usage = extractUsage(outputData?.[0]?.json) || extractUsage(finalJson?.[0]) || extractUsage(result);
            if (usage) {
              if (usage.prompt_tokens) span.setAttribute("gen_ai.usage.input_tokens", usage.prompt_tokens);
              if (usage.completion_tokens) span.setAttribute("gen_ai.usage.output_tokens", usage.completion_tokens);
              if (usage.total_tokens) span.setAttribute("gen_ai.usage.total_tokens", usage.total_tokens);
            }

            if (DEBUG) {
              try { console.log("[OTEL] node output", { node: node.name, outputData: finalJson }); } catch (_) {}
            }

            return result;
          } catch (error) {
            span.recordException(error);
            span.setStatus({ code: SpanStatusCode.ERROR, message: String(error.message || error) });
            throw error;
          } finally {
            if (maybeSystem || attrs["gen_ai.request.model"]) {
              const provider = maybeSystem || attrs["gen_ai.provider.name"] || "unknown";
              const model = attrs["gen_ai.request.model"] || attrs["gen_ai.response.model"] || "unknown";
              span.setAttribute("gen_ai.summary", `${provider}:${model}`);
            }
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

const Anthropic = require("@anthropic-ai/sdk");
const OpenAI = require("openai");
const { GoogleGenAI } = require("@google/genai");
function structuredSystem(system, schema) {
  return system + "\n\nReturn only a valid JSON value matching this schema. Do not wrap it in Markdown or add commentary:\n" + JSON.stringify(schema);
}
function parseResponse(text, truncated) {
  if (truncated) throw new Error("AI_OUTPUT_TRUNCATED");
  if (typeof text !== "string" || !text.trim()) throw new Error("AI_EMPTY_RESPONSE");
  const clean = text.replace(/^\uFEFF/, "").trim();
  const fenced = clean.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  try { return JSON.parse(fenced ? fenced[1] : clean); }
  catch { throw new Error("AI_INVALID_RESPONSE"); }
}
function baseURL(variable, fallback) {
  const value = process.env[variable]?.trim() || fallback;
  try {
    const url = new URL(value);
    const railwayHTTP =
      url.protocol === "http:" &&
      process.env.AI_ALLOW_RAILWAY_INTERNAL_HTTP === "true" &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.railway\.internal$/.test(
        url.hostname,
      );
    if (
      (url.protocol !== "https:" && !railwayHTTP) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.href.replace(/\/+$/, "");
  } catch {
    throw new Error("INVALID_" + variable);
  }
}
async function providerFetch(url, options) {
  const response = await fetch(url, { ...options, redirect: "error" });
  if (response.status >= 300 && response.status < 400)
    throw new Error("AI_REDIRECT_REJECTED");
  return response;
}
function loadAIConfig() {
  return {
    defaultProvider: process.env.AI_PROVIDER || "openai",
    providers: {
      openai: {
        apiKey: process.env.OPENAI_API_KEY || "",
        baseURL: baseURL("OPENAI_BASE_URL", "https://api.openai.com/v1"),
        model: process.env.OPENAI_MODEL || "gpt-5-nano",
      },
      anthropic: {
        apiKey: process.env.ANTHROPIC_API_KEY || "",
        baseURL: baseURL("ANTHROPIC_BASE_URL", "https://api.anthropic.com"),
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
      },
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || "",
        model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
      },
    },
  };
}

function getAIStatus() {
  const { defaultProvider, providers } = loadAIConfig();
  const providerList = Object.keys(providers).map((id) => ({
    id,
    available: Boolean(providers[id].apiKey),
    model: providers[id].model,
    endpointOrigin: new URL(
      providers[id].baseURL || "https://generativelanguage.googleapis.com",
    ).origin,
    configured: Boolean(providers[id].apiKey),
  }));

  return { defaultProvider, providers: providerList };
}

async function anthropicGenerate({
  system,
  prompt,
  schema,
  apiKey,
  baseURL,
  model,
  maxTokens = 8192,
}) {
  const client = new Anthropic({
    apiKey,
    baseURL,
    fetch: providerFetch,
    maxRetries: 0,
    timeout: 60000,
  });
  const resp = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: structuredSystem(system, schema),
    output_config: { format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: prompt }],
  });

  const text = resp.content.filter((b) => b.type === "text").map(b => b.text).join("");
  return {
    data: parseResponse(text, resp.stop_reason === "max_tokens"),
    usage: {
      inputTokens: resp.usage?.input_tokens || 0,
      outputTokens: resp.usage?.output_tokens || 0,
    },
  };
}

async function openaiGenerate({
  system,
  prompt,
  schema,
  apiKey,
  baseURL,
  model,
  maxTokens = 8192,
}) {
  const openai = new OpenAI({
    apiKey,
    baseURL,
    fetch: providerFetch,
    maxRetries: 0,
    timeout: 60000,
  });

  // Model capabilities check
  const isModern =
    model.startsWith("o1") ||
    model.startsWith("o3") ||
    model.startsWith("gpt-4o") ||
    model.startsWith("gpt-5");
  const supportsStructured = isModern || model.includes("2024-08-06");

  const params = {
    model,
    messages: [
      { role: "system", content: structuredSystem(system, schema) },
      { role: "user", content: prompt },
    ],
  };

  // 1. Handle tokens parameter (modern vs legacy)
  if (isModern) {
    params.max_completion_tokens = maxTokens;
  } else {
    params.max_tokens = maxTokens;
  }

  // 2. Handle response format
  if (supportsStructured) {
    params.response_format = {
      type: "json_schema",
      json_schema: {
        name: "structured_output",
        strict: false,
        schema,
      },
    };
  } else {
    // Fallback for older models that support JSON Mode but not json_schema
    params.response_format = { type: "json_object" };
  }

  const resp = await openai.chat.completions.create(params);

  const text = resp.choices[0]?.message?.content;
  return {
    data: parseResponse(text, resp.choices[0]?.finish_reason === "length"),
    usage: {
      inputTokens: resp.usage?.prompt_tokens || 0,
      outputTokens: resp.usage?.completion_tokens || 0,
    },
  };
}

async function geminiGenerate({ system, prompt, schema, apiKey, model }) {
  const ai = new GoogleGenAI({
    apiKey,
    vertexai: false,
    httpOptions: { baseUrl: "https://generativelanguage.googleapis.com" },
  });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction: structuredSystem(system, schema),
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const text = response.text;
  return {
    data: parseResponse(text, response.candidates?.[0]?.finishReason === "MAX_TOKENS"),
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount || 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
    },
  };
}

async function generateJSON({
  system,
  prompt,
  schema,
  provider,
  customModel,
  maxTokens = 8192,
}) {
  const { defaultProvider, providers } = loadAIConfig();
  const selectedProvider = provider || defaultProvider;
  const pConfig = providers[selectedProvider] || {};

  const activeModel = customModel || pConfig.model;
  let result;

  const apiKey = pConfig.apiKey;
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");

  if (selectedProvider === "anthropic") {
    result = await anthropicGenerate({
      system,
      prompt,
      schema,
      apiKey,
      baseURL: pConfig.baseURL,
      model: activeModel,
      maxTokens,
    });
  } else if (selectedProvider === "openai") {
    result = await openaiGenerate({
      system,
      prompt,
      schema,
      apiKey,
      baseURL: pConfig.baseURL,
      model: activeModel,
      maxTokens,
    });
  } else if (selectedProvider === "gemini") {
    result = await geminiGenerate({
      system,
      prompt,
      schema,
      apiKey,
      model: activeModel,
    });
  } else {
    throw new Error(`Unsupported AI provider: ${selectedProvider}`);
  }

  return {
    ...result,
    provider: selectedProvider,
    model: activeModel,
  };
}

module.exports = {
  loadAIConfig,
  getAIStatus,
  generateJSON,
};

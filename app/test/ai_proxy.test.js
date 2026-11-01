const assert = require("node:assert/strict");
const { loadAIConfig, getAIStatus, generateJSON } = require("../lib/ai");
(async () => {
  const nativeFetch = global.fetch;
  const envKeys = [
    "AI_PROVIDER",
    "AI_ALLOW_RAILWAY_INTERNAL_HTTP",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_BASE_URL",
  ];
  const saved = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]]),
  );
  const requests = [];
  let responseStatus = 200;
  let responseText, finishReason = "stop";
  const output = {
    summary: "Synthetic response",
    recommendations: [],
    candidates: [],
  };
  global.fetch = async (url, options) => {
    const headers = new Headers(options.headers),
      body = JSON.parse(options.body);
    requests.push({
      url: String(url),
      headers,
      body,
      redirect: options.redirect,
    });
    if (responseStatus === 302)
      return new Response(null, {
        status: 302,
        headers: { location: "https://untrusted.invalid/redirect" },
      });
    if (responseStatus === 401)
      return new Response(
        JSON.stringify({ error: { message: "Synthetic auth failure" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    const data = String(url).includes("/messages")
      ? {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [{ type: "text", text: responseText ?? JSON.stringify(output) }],
          stop_reason: finishReason === "length" ? "max_tokens" : "end_turn",
          usage: { input_tokens: 2, output_tokens: 3 },
        }
      : {
          id: "chatcmpl_test",
          object: "chat.completion",
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: responseText ?? JSON.stringify(output) },
              finish_reason: finishReason,
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        };
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    envKeys.forEach((key) => delete process.env[key]);
    assert.equal(
      loadAIConfig().providers.openai.baseURL,
      "https://api.openai.com/v1",
    );
    assert.equal(
      loadAIConfig().providers.anthropic.baseURL,
      "https://api.anthropic.com",
    );
    for (const key of ["OPENAI_BASE_URL", "ANTHROPIC_BASE_URL"]) {
      for (const value of [
        "http://proxy.invalid",
        "https://user:pass@proxy.invalid",
        "https://proxy.invalid?key=private",
        "https://proxy.invalid#key",
        "not-a-url",
        "file:///tmp/socket",
      ]) {
        process.env[key] = value;
        assert.throws(loadAIConfig, new RegExp("INVALID_" + key));
      }
      delete process.env[key];
    }
    for (const key of ["OPENAI_BASE_URL", "ANTHROPIC_BASE_URL"]) {
      process.env[key] = "http://cli-proxy-api.railway.internal:8317/v1";
      assert.throws(loadAIConfig, new RegExp("INVALID_" + key));
      process.env.AI_ALLOW_RAILWAY_INTERNAL_HTTP = "true";
      assert.equal(
        loadAIConfig().providers[
          key === "OPENAI_BASE_URL" ? "openai" : "anthropic"
        ].baseURL,
        process.env[key],
      );
      for (const host of [
        "proxy.example",
        "127.0.0.1",
        "localhost",
        "railway.internal",
        "cli-proxy-api.railway.internal.evil.example",
        "cli-proxy-api.railway.internal@evil.example",
        "foo.bar.railway.internal",
      ]) {
        process.env[key] = "http://" + host + ":8317";
        assert.throws(loadAIConfig, new RegExp("INVALID_" + key));
      }
      process.env[key] =
        "http://user:password@cli-proxy-api.railway.internal:8317";
      assert.throws(loadAIConfig, new RegExp("INVALID_" + key));
      delete process.env[key];
      delete process.env.AI_ALLOW_RAILWAY_INTERNAL_HTTP;
    }
    process.env.OPENAI_API_KEY = "synthetic-openai-proxy-key";
    process.env.ANTHROPIC_API_KEY = "synthetic-anthropic-proxy-key";
    process.env.OPENAI_BASE_URL = " https://openai.proxy.invalid/gateway/v1/ ";
    process.env.ANTHROPIC_BASE_URL = "https://anthropic.proxy.invalid/gateway/";
    process.env.OPENAI_MODEL = "custom-model";
    process.env.ANTHROPIC_MODEL = "claude-custom";
    const input = {
      system: "Return JSON only.",
      prompt: "Synthetic public listing only.",
      schema: { type: "object", properties: { summary: { type: "string" } } },
      maxTokens: 123,
    };
    const openai = await generateJSON({ ...input, provider: "openai" });
    assert.deepEqual(openai.data, output);
    assert.equal(openai.model, "custom-model");
    const openaiRequest = requests.at(-1);
    assert.equal(
      openaiRequest.url,
      "https://openai.proxy.invalid/gateway/v1/chat/completions",
    );
    assert.equal(
      openaiRequest.headers.get("authorization"),
      "Bearer synthetic-openai-proxy-key",
    );
    assert.equal(openaiRequest.headers.get("x-api-key"), null);
    assert.equal(openaiRequest.body.model, "custom-model");
    assert.equal(openaiRequest.body.max_tokens, 123);
    assert.equal(openaiRequest.redirect, "error");
    const anthropic = await generateJSON({ ...input, provider: "anthropic" });
    assert.deepEqual(anthropic.data, output);
    assert.equal(anthropic.usage.inputTokens, 2);
    const anthropicRequest = requests.at(-1);
    assert.equal(
      anthropicRequest.url,
      "https://anthropic.proxy.invalid/gateway/v1/messages",
    );
    assert.equal(
      anthropicRequest.headers.get("x-api-key"),
      "synthetic-anthropic-proxy-key",
    );
    assert.equal(anthropicRequest.headers.get("authorization"), null);
    assert.ok(anthropicRequest.headers.get("anthropic-version"));
    assert.equal(anthropicRequest.body.model, "claude-custom");
    assert.equal(anthropicRequest.redirect, "error");
    process.env.AI_ALLOW_RAILWAY_INTERNAL_HTTP = "true";
    process.env.OPENAI_BASE_URL =
      "http://cli-proxy-api.railway.internal:8317/v1";
    await generateJSON({ ...input, provider: "openai" });
    assert.equal(
      requests.at(-1).url,
      "http://cli-proxy-api.railway.internal:8317/v1/chat/completions",
    );
    assert.equal(requests.at(-1).redirect, "error");
    process.env.ANTHROPIC_BASE_URL='http://cli-proxy-api.railway.internal:8317';
    await generateJSON({...input,provider:'anthropic'});
    assert.equal(requests.at(-1).url,'http://cli-proxy-api.railway.internal:8317/v1/messages');
    assert.equal(requests.at(-1).redirect,'error');
    process.env.ANTHROPIC_BASE_URL='https://anthropic.proxy.invalid/gateway';
    process.env.OPENAI_BASE_URL = "https://openai.proxy.invalid/gateway/v1";
    delete process.env.AI_ALLOW_RAILWAY_INTERNAL_HTTP;
    const status = JSON.stringify(getAIStatus());
    assert.ok(status.includes("https://openai.proxy.invalid"));
    assert.ok(!status.includes("synthetic-openai-proxy-key"));
    assert.ok(!status.includes("/gateway"));
    for (const provider of ["openai", "anthropic"]) {
      responseStatus = 200;
      responseText = "```json\n" + JSON.stringify(output) + "\n```";
      assert.deepEqual((await generateJSON({ ...input, provider })).data, output);
      const sentSystem = provider === "openai" ? requests.at(-1).body.messages[0].content : requests.at(-1).body.system;
      assert.match(sentSystem, /Return only a valid JSON/);
      responseText = "";
      await assert.rejects(generateJSON({ ...input, provider }), /AI_EMPTY_RESPONSE/);
      responseText = "Unexpected text containing synthetic-secret-do-not-log";
      await assert.rejects(generateJSON({ ...input, provider }), error => error.message === "AI_INVALID_RESPONSE");
      responseText = JSON.stringify(output);
      finishReason = "length";
      await assert.rejects(generateJSON({ ...input, provider }), /AI_OUTPUT_TRUNCATED/);
      finishReason = "stop";
      responseText = undefined;
      responseStatus = 302;
      let before = requests.length;
      await assert.rejects(generateJSON({ ...input, provider }));
      assert.equal(requests.length, before + 1, "No redirect or retry");
      responseStatus = 401;
      before = requests.length;
      await assert.rejects(generateJSON({ ...input, provider }));
      assert.equal(
        requests.length,
        before + 1,
        "No retry or provider fallback",
      );
    }
    assert.ok(
      requests.every(
        (request) =>
          !JSON.stringify(request.body).includes(
            "synthetic-openai-proxy-key",
          ) &&
          !JSON.stringify(request.body).includes(
            "synthetic-anthropic-proxy-key",
          ),
      ),
    );
    console.log(
      "PASS: OpenAI/Anthropic proxy routes, provider-specific auth, model/path handling, safe status, URL validation and no redirects/retries/fallback. No network calls.",
    );
  } finally {
    global.fetch = nativeFetch;
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

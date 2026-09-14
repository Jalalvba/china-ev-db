// Single AI client shared by every research script/lib — talks directly to
// whichever provider AI_PROVIDER selects (deepseek | kimi | qwen), no
// third-party gateway in front. All three expose an OpenAI-compatible REST
// API, so this uses the `openai` SDK three different ways (base_url +
// api_key per provider) rather than three separate provider SDKs:
//   - DeepSeek:          https://api.deepseek.com                             (official docs recommend the OpenAI SDK directly)
//   - Kimi / Moonshot AI: https://api.moonshot.cn/v1                          (official docs: " fully compatible with OpenAI SDK")
//   - Qwen / DashScope:   https://dashscope.aliyuncs.com/compatible-mode/v1   (Alibaba's own "OpenAI-compatible mode" endpoint)
//
// Previously routed through a third-party gateway, and before that a direct
// Gemini integration (@google/genai) — see git history for both.
//
// None of these models have a native, trustable "I actually searched the
// web" signal — see lib/webSearch.ts for the real-search-first design that
// replaces it: callers fetch real search results themselves and feed the
// actual snippets/URLs into the prompt, then only trust "confirmed" when the
// extracted claim traces back to a real fetched source.

import OpenAI from "openai";

export class ModelNotFoundError extends Error {
  constructor(model: string) {
    super(`Model "${model}" was not found (or the active provider rejected it) — check the provider's model catalog.`);
    this.name = "ModelNotFoundError";
  }
}

export type ProviderId = "deepseek" | "kimi" | "qwen";

interface ProviderConfig {
  baseURL: string;
  /** env var holding this provider's API key */
  apiKeyEnv: string;
  /** env var letting the model be overridden per-provider */
  modelEnv: string;
  defaultModel: string;
  /** Where to get a key — surfaced in the "missing key" error. */
  keysUrl: string;
}

const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  deepseek: {
    baseURL: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat",
    keysUrl: "https://platform.deepseek.com/api_keys",
  },
  kimi: {
    baseURL: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
    modelEnv: "MOONSHOT_MODEL",
    defaultModel: "moonshot-v1-32k",
    keysUrl: "https://platform.moonshot.cn/console/api-keys",
  },
  qwen: {
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKeyEnv: "QWEN_API_KEY",
    modelEnv: "QWEN_MODEL",
    defaultModel: "qwen-max",
    keysUrl: "https://dashscope.console.aliyun.com/apiKey",
  },
};

const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

function resolveActiveProviderId(): ProviderId {
  const raw = (process.env.AI_PROVIDER ?? "deepseek").trim().toLowerCase();
  if ((PROVIDER_IDS as string[]).includes(raw)) return raw as ProviderId;
  throw new Error(`Invalid AI_PROVIDER "${raw}" — must be one of: ${PROVIDER_IDS.join(", ")}.`);
}

// Deliberately NOT resolved into a top-level `const` here (that was a real
// bug, caught during a live Qwen smoke test): every CLI script in this
// codebase calls `dotenv.config()` as its own first statement, but ES
// `import` declarations are hoisted above all other top-level code —
// including a manual dotenv.config() call textually written above the
// import — so a module-level `const ACTIVE_PROVIDER = resolveActiveProviderId()`
// here would evaluate against whatever AI_PROVIDER happened to already be in
// process.env at process start, silently ignoring .env.local/.env entirely.
// Resolving lazily, only when a script/route actually calls one of these
// functions (always well after its own dotenv.config() has run), fixes it.
let cachedProviderId: ProviderId | null = null;

/** The active provider's id (deepseek | kimi | qwen), from AI_PROVIDER — resolved lazily on first call (see comment above), then cached for the life of the process. */
export function getActiveProvider(): ProviderId {
  if (!cachedProviderId) cachedProviderId = resolveActiveProviderId();
  return cachedProviderId;
}

function getActiveConfig(): ProviderConfig {
  return PROVIDERS[getActiveProvider()];
}

/** This provider's model, from its own <PROVIDER>_MODEL env var, falling back to its documented default chat model. Resolved lazily — see getActiveProvider(). */
export function getDefaultModel(): string {
  const config = getActiveConfig();
  return process.env[config.modelEnv] ?? config.defaultModel;
}

let client: OpenAI | null = null;
let clientForProvider: ProviderId | null = null;

function getApiKey(): string {
  const config = getActiveConfig();
  const key = process.env[config.apiKeyEnv];
  if (!key) {
    throw new Error(`Missing ${config.apiKeyEnv} for AI_PROVIDER=${getActiveProvider()}. Create a key at ${config.keysUrl} and set it in .env.`);
  }
  return key;
}

/** Provider-agnostic upfront check for callers (API routes, scripts) that want to fail fast with a friendly message before doing any other work, rather than letting the first complete()/completeTwoTurn() call throw mid-request. Returns null when the active provider's key is present, or the exact "missing X" message otherwise. */
export function getMissingConfigError(): string | null {
  const config = getActiveConfig();
  return process.env[config.apiKeyEnv] ? null : `Missing ${config.apiKeyEnv} for AI_PROVIDER=${getActiveProvider()}.`;
}

function getClient(): OpenAI {
  // Re-create if the resolved provider ever differs from what the cached
  // client was built for — can only happen in a long-lived process (the
  // Next.js dev/prod server) if AI_PROVIDER itself changes at runtime, which
  // doesn't normally happen, but this keeps the cache honest rather than
  // silently serving requests against the wrong provider's client.
  const providerId = getActiveProvider();
  if (!client || clientForProvider !== providerId) {
    client = new OpenAI({
      apiKey: getApiKey(),
      baseURL: getActiveConfig().baseURL,
    });
    clientForProvider = providerId;
  }
  return client;
}

export interface CompleteOptions {
  model?: string;
  maxTokens?: number;
  /** Appended as a system message ahead of the user prompt — optional, most callers here build one big user-role prompt instead. */
  system?: string;
}

/**
 * Minimal one-shot text completion — deliberately thin (no tool-calling, no
 * streaming, no provider-specific options) so call sites can't accidentally
 * depend on a provider-specific capability the next model swap might not
 * have. Every research flow in this codebase already does its own
 * multi-turn orchestration (kickoff prompt -> real search -> format prompt)
 * at the call-site level; this function is just the one primitive they all
 * share for "ask the model something, get text back".
 */
export async function complete(prompt: string, options: CompleteOptions = {}): Promise<string> {
  const model = options.model ?? getDefaultModel();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: prompt });

  try {
    const response = await getClient().chat.completions.create({
      model,
      messages,
      max_tokens: options.maxTokens,
    });
    return response.choices[0]?.message?.content ?? "";
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) throw new ModelNotFoundError(model);
    throw err;
  }
}

/** Two-turn completion (kickoff prompt, then a follow-up that sees the first turn's answer as prior conversation) — the shape every research flow in this codebase uses: a prose research turn, then a second turn that reformats the same grounded findings into strict JSON. */
export async function completeTwoTurn(
  kickoffPrompt: string,
  formatPrompt: string,
  options: CompleteOptions = {}
): Promise<{ kickoffText: string; formattedText: string }> {
  const model = options.model ?? getDefaultModel();
  const client = getClient();

  try {
    const kickoff = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: kickoffPrompt }],
      max_tokens: options.maxTokens,
    });
    const kickoffText = kickoff.choices[0]?.message?.content ?? "";

    const format = await client.chat.completions.create({
      model,
      messages: [
        { role: "user", content: kickoffPrompt },
        { role: "assistant", content: kickoffText },
        { role: "user", content: formatPrompt },
      ],
      max_tokens: options.maxTokens,
    });
    const formattedText = format.choices[0]?.message?.content ?? "";

    return { kickoffText, formattedText };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (status === 404) throw new ModelNotFoundError(model);
    throw err;
  }
}

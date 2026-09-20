/**
 * Pure mapping helpers for the connection-settings control plane: input
 * normalization, relay provider/profile wire shapes, provider views, and the
 * small object guards they share. Stateless — the service class in
 * `../connection-settings-service.ts` drives these with a live client.
 */
import type { LlmConfigurableProvider as ConfigurableProviderView } from '@deepseek-ai/dsh-llm/types'
import type { SettingsNamespaceView } from '@deepseek-ai/dsh-settings/types'
import type { NodeGatewayClient } from '../../gateway/node-gateway-client.js'
import { validateBaseUrl } from '../../domain/base-url.js'
import { modelCapacity } from '../../domain/model-capacity.js'
import { supportsImageInput } from '../../domain/model-modalities.js'
import {
  DEEPSEEK_OFFICIAL_BASE_URL,
  DEEPSEEK_OFFICIAL_PROVIDER,
  providerKeyEnv,
  providerRoute,
  type CustomProvider,
} from '../../domain/provider.js'
import type {
  ConnectionProviderView,
  ConnectionSettingsInput,
} from '../../domain/connection-settings.js'

export const PI_AI_SETTINGS_NS = 'llm-pi-ai'
export const DEEPSEEK_SETTINGS_NS = 'llm-deepseek'

/** The slice of the API client the settings adapter talks to. */
export type ProviderControlClient = Pick<NodeGatewayClient,
  | 'settingsDescribe' | 'settingsMutate'
  | 'credentialsDescribe' | 'credentialsSet' | 'credentialsUnset'
  | 'llmListProviders' | 'llmListConfigurableProviders' | 'llmDiscoverModels'
  | 'sessionModelCatalog'>

/** Reads `{ result: { ok: true, value } | { ok: false, error } }` envelopes. */
export function valueOf<T>(response: { readonly result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly message: string } } }): T {
  if (!response.result.ok) throw new Error(response.result.error.message)
  return response.result.value
}

/** Walks a possibly-undefined nested object path, returning undefined on the way. */
export function valueAt(root: unknown, path: readonly string[]): unknown {
  let current = root
  for (const key of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** The `apiKeyEnv` a relay profile addresses, with the conventional fallback. */
export function credentialRefForProfile(profile: unknown, provider: string): string {
  return stringField(profile, 'apiKeyEnv') ?? providerKeyEnv(provider)
}

/** The credential ref used for one provider, official route included. */
export function credentialRef(entry: ConfigurableProviderView, namespace: SettingsNamespaceView | undefined): string {
  if (entry.provider === DEEPSEEK_OFFICIAL_PROVIDER) return 'DEEPSEEK_API_KEY'
  return credentialRefForProfile(valueAt(namespace?.value, entry.settingsPath), entry.provider)
}

/** Validates raw form input and fills derived fields (relay models, context overrides) before it is persisted. */
export function normalizeInput(input: ConnectionSettingsInput): ConnectionSettingsInput {
  const name = input.name.trim()
  const baseUrl = input.baseUrl.trim()
  const apiKey = input.apiKey.trim()
  if (input.provider !== DEEPSEEK_OFFICIAL_PROVIDER && name === '') throw new Error('The provider name cannot be empty.')
  if (baseUrl === '') {
    if (input.provider === DEEPSEEK_OFFICIAL_PROVIDER) {
      return { ...input, name, baseUrl: DEEPSEEK_OFFICIAL_BASE_URL, apiKey, modelContextWindows: {} }
    }
    throw new Error('The provider base URL cannot be empty.')
  }
  if (!validateBaseUrl(baseUrl).valid) throw new Error('The Base URL must be a valid http(s) URL.')
  const models = input.provider === DEEPSEEK_OFFICIAL_PROVIDER
    ? []
    : normalizeRelayModels(input.models)
  const modelContextWindows = input.provider === DEEPSEEK_OFFICIAL_PROVIDER
    ? {}
    : normalizeModelContextWindows(input.modelContextWindows, models)
  return { ...input, name, baseUrl, apiKey, models, modelContextWindows }
}

/**
 * A custom relay endpoint is addressed by the model ids it actually exposes
 * (e.g. a Volcengine Ark model id or endpoint). Empty input keeps the
 * extension's DeepSeek defaults so existing behavior is preserved.
 */
export function normalizeRelayModels(models: readonly string[] | undefined): readonly string[] {
  const ids = (models ?? [])
    .map((model) => model.trim())
    .filter((model) => model !== '')
  return [...new Set(ids)]
}

/**
 * Keeps only positive-integer overrides for ids the provider actually
 * exposes; anything else (a stale override for a removed model, a
 * non-numeric or non-positive value) is dropped rather than persisted.
 */
export function normalizeModelContextWindows(
  contextWindows: Readonly<Record<string, number>> | undefined,
  models: readonly string[],
): Readonly<Record<string, number>> {
  if (contextWindows === undefined) return {}
  const known = new Set(models)
  const normalized: Record<string, number> = {}
  for (const [id, value] of Object.entries(contextWindows)) {
    if (!known.has(id)) continue
    if (!Number.isFinite(value)) continue
    const contextWindow = Math.round(value)
    if (contextWindow <= 0) continue
    normalized[id] = contextWindow
  }
  return normalized
}

/** Reasoning effort wire map the extension writes for custom relay models. */
export const RELAY_REASONING_EFFORTS = { off: null, low: 'low', high: 'high', max: 'max' } as const

/** Map shape written by builds before the low tier existed (pre rc.7). */
const LEGACY_RELAY_REASONING_EFFORTS = { off: null, high: 'high', max: 'max' } as const

export function isLegacyRelayReasoningEfforts(efforts: object): boolean {
  const entries = Object.entries(efforts)
  const legacy = Object.entries(LEGACY_RELAY_REASONING_EFFORTS) as [string, unknown][]
  return entries.length === legacy.length
    && legacy.every(([key, value]) => (efforts as Record<string, unknown>)[key] === value)
}

/**
 * Wire model entries carrying the extension's effort map, modalities and
 * effective capacity. The published adapter resolves each model as
 * `entry.contextWindow ?? catalog.contextWindow ?? defaultContextWindow`,
 * where the default is 262144, and maps usage above the resolved value to
 * `CONTEXT_WINDOW_EXCEEDED` — so the effective window (user override, else
 * the bundled capacity table's value) must be persisted in the entry,
 * otherwise table models with larger capacities are flagged as overflow.
 * `maxTokens` is always table-sourced: it is a runtime clamp that never
 * renders back into the settings form.
 */
export function relayModels(
  models: readonly string[],
  contextWindows?: Readonly<Record<string, number>>,
): { id: string; reasoningEfforts: object; input?: readonly string[]; contextWindow?: number; maxTokens?: number }[] {
  const ids = models.length > 0 ? models : ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']
  return ids.map((id) => {
    const override = contextWindows?.[id]
    const capacity = modelCapacity(id)
    const contextWindow = override ?? capacity?.contextWindow
    return {
      id,
      reasoningEfforts: { ...RELAY_REASONING_EFFORTS },
      // The pi-ai adapter serves an entry without `input` as text-only, so a
      // vision route must declare its modalities or image prompts are rejected
      // at admission even after the session switched to it.
      ...(supportsImageInput(id) ? { input: ['text', 'image'] } : {}),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(capacity?.maxTokens === undefined ? {} : { maxTokens: capacity.maxTokens }),
    }
  })
}

/**
 * The `authorization` header a keyless relay profile carries. pi-ai's
 * openai-completions transport refuses to stream when it is given neither an
 * apiKey nor an `authorization` header (`No API key for provider`); a
 * non-empty header satisfies that check and lets the request go out
 * unauthenticated. Keyless endpoints ignore the header's value, so this fixed
 * sentinel only exists to pass the transport's guard — it is not a credential.
 */
export const KEYLESS_AUTHORIZATION = 'Bearer keyless'

/**
 * Assembles the wire profile a custom relay provider is written with.
 *
 * Omit `apiKeyEnv` (pass `undefined`) for a deliberately keyless provider.
 * That omits the credential ref entirely, so the pi-ai adapter resolves the
 * route to no credential instead of failing every request with
 * `MISSING_CREDENTIAL` (only a ref that names an unset credential throws). For
 * a keyless profile it also writes `headers.authorization` with
 * {@link KEYLESS_AUTHORIZATION}: the transport's `getClientApiKey` throws
 * `No API key for provider` unless an `apiKey` or an `authorization` header is
 * present, so omitting `apiKeyEnv` alone would still break every completion.
 * A keyed profile writes `apiKeyEnv` and no placeholder header.
 */
export function deepSeekRelayProfile(
  displayName: string,
  baseURL: string,
  apiKeyEnv?: string,
  models?: readonly string[],
  contextWindows?: Readonly<Record<string, number>>,
): object {
  const keyless = apiKeyEnv === undefined
  return {
    displayName,
    ...(!keyless ? { apiKeyEnv } : {}),
    ...(keyless ? { headers: { authorization: KEYLESS_AUTHORIZATION } } : {}),
    api: 'openai-completions',
    baseURL,
    compat: relayCompat(),
    models: relayModels(models ?? [], contextWindows),
  }
}

export function relayCompat(): object {
  return {
    thinkingFormat: 'deepseek',
    supportsReasoningEffort: true,
    supportsDeveloperRole: false,
  }
}

/** Shapes one provider directory entry into the extension's small view. */
export function providerView(
  entry: ConfigurableProviderView,
  namespace: SettingsNamespaceView | undefined,
  credential: { readonly configured: boolean; readonly writable: boolean } | undefined,
): ConnectionProviderView {
  const profile = valueAt(namespace?.value, entry.settingsPath)
  const baseUrl = stringField(profile, 'baseURL')
    ?? (entry.provider === DEEPSEEK_OFFICIAL_PROVIDER ? DEEPSEEK_OFFICIAL_BASE_URL : '')
  return {
    id: entry.provider,
    name: entry.displayName,
    baseUrl,
    models: modelsField(profile),
    modelContextWindows: modelContextWindowsField(profile),
    apiKeyConfigured: credential?.configured === true,
    credentialWritable: credential?.writable === true,
    removable: entry.settingsPath.length > 0 && valueAt(namespace?.user, entry.settingsPath) !== undefined,
  }
}

/** The relay profile imported from a legacy base URL (hostname-derived name). */
export function importedRelay(baseUrl: string, apiKey: string | undefined): {
  route: string
  provider: CustomProvider
} {
  const hostname = new URL(baseUrl).hostname.replace(/^www\./u, '')
  const name = `Imported ${hostname}`
  return {
    route: providerRoute(name),
    provider: { name, baseUrl, apiKey: apiKey?.trim() ?? '' },
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.trim() !== '' ? field.trim() : undefined
}

function modelsField(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  const models = (value as Record<string, unknown>)['models']
  if (!Array.isArray(models)) return []
  return models
    .map((model) => (typeof model === 'object' && model !== null
      ? stringField(model, 'id')
      : typeof model === 'string' ? model : undefined))
    .filter((model): model is string => model !== undefined)
}

/**
 * Reads back the context windows the user explicitly set on each model
 * entry, so the settings form pre-fills only actual user overrides. The
 * adapter-owned table backfill also lives in the persisted entries (the
 * adapter's overflow mapping needs the effective window), so entries whose
 * value equals the bundled capacity table's value are excluded here.
 */
function modelContextWindowsField(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const models = (value as Record<string, unknown>)['models']
  if (!Array.isArray(models)) return {}
  const result: Record<string, number> = {}
  for (const model of models) {
    if (typeof model !== 'object' || model === null || Array.isArray(model)) continue
    const record = model as Record<string, unknown>
    const id = record['id']
    const contextWindow = record['contextWindow']
    if (typeof id !== 'string' || id === '' || typeof contextWindow !== 'number' || contextWindow <= 0) continue
    // The table-equal value is the adapter-owned backfill, not a user edit.
    if (modelCapacity(id)?.contextWindow === contextWindow) continue
    result[id] = contextWindow
  }
  return result
}


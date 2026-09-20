import { AGENT_PRESET_OPTIONS } from './options.js'

export interface PresetDisplaySource {
  readonly id: string
  readonly trust: 'system' | 'user'
  readonly name?: string
  readonly description?: string
}

export interface PresetDisplayText {
  readonly name: string
  readonly description?: string
}

// Old extension settings used `code`; the official preset id is now `ptc`.
const BUILT_IN_PRESET_ALIASES: Record<string, string> = { code: 'ptc' }

/**
 * Resolves display copy for one roster preset row. The bundled harness only
 * ships Chinese `name`/`description` text for its built-in presets, so for
 * presets it authors (`trust: 'system'`) this substitutes this extension's
 * own catalog copy (translated through `t`, e.g. `vscode.l10n.t`) instead of
 * the raw harness text. User-authored presets pass through untouched so a
 * user's own custom names/descriptions are never "corrected".
 */
export function localizedPresetDisplay<T extends PresetDisplaySource>(
  preset: T,
  t: (source: string) => string,
): T & PresetDisplayText {
  const catalogId = BUILT_IN_PRESET_ALIASES[preset.id] ?? preset.id
  const catalogEntry = preset.trust === 'system'
    ? AGENT_PRESET_OPTIONS.find((option) => option.id === catalogId)
    : undefined
  if (catalogEntry === undefined) {
    return {
      ...preset,
      name: preset.name ?? preset.id,
      ...(preset.description === undefined ? {} : { description: preset.description }),
    }
  }
  return { ...preset, name: t(catalogEntry.label), description: t(catalogEntry.description) }
}

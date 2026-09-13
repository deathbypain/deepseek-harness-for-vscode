import { describe, expect, it } from 'vitest'
import { parseModelsField } from '../src/webview/connection-settings/component.js'

describe('parseModelsField', () => {
  it('parses bare ids with no context window', () => {
    expect(parseModelsField('deepseek-v4-flash, deepseek-v4-pro')).toEqual({
      ids: ['deepseek-v4-flash', 'deepseek-v4-pro'],
      contextWindows: {},
    })
  })

  it('parses an id:contextSize suffix in raw tokens', () => {
    expect(parseModelsField('gemma-4-12b-heretic:32768')).toEqual({
      ids: ['gemma-4-12b-heretic'],
      contextWindows: { 'gemma-4-12b-heretic': 32_768 },
    })
  })

  it('accepts k/m shorthand suffixes', () => {
    expect(parseModelsField('model-a:32k, model-b:1m, model-c:8K')).toEqual({
      ids: ['model-a', 'model-b', 'model-c'],
      contextWindows: { 'model-a': 32_768, 'model-b': 1_048_576, 'model-c': 8_192 },
    })
  })

  it('mixes ids with and without an explicit size', () => {
    expect(parseModelsField('gpt-oss-20b, gemma-4-12b-heretic:32k')).toEqual({
      ids: ['gpt-oss-20b', 'gemma-4-12b-heretic'],
      contextWindows: { 'gemma-4-12b-heretic': 32_768 },
    })
  })

  it('ignores an invalid or non-positive size suffix but keeps the id', () => {
    expect(parseModelsField('model-a:not-a-number, model-b:0, model-c:-5')).toEqual({
      ids: ['model-a', 'model-b', 'model-c'],
      contextWindows: {},
    })
  })

  it('splits on commas, spaces, and full-width commas alike', () => {
    expect(parseModelsField('model-a:32k model-b:64k，model-c')).toEqual({
      ids: ['model-a', 'model-b', 'model-c'],
      contextWindows: { 'model-a': 32_768, 'model-b': 65_536 },
    })
  })
})

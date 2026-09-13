// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileReferenceKey, type FileReference } from '../src/webview/file-reference.js'
import {
  applyReferenceValidation, renderMarkdown, resetReferenceValidation, setReferenceValidator,
  type MarkdownActions,
} from '../src/webview/markdown.js'

beforeEach(() => {
  vi.useFakeTimers()
  resetReferenceValidation()
})
afterEach(() => {
  resetReferenceValidation()
  document.body.replaceChildren()
  vi.useRealTimers()
})

function setup() {
  const target = document.createElement('div')
  document.body.append(target)
  const validate = vi.fn()
  setReferenceValidator(validate)
  const actions: MarkdownActions = {
    openFile: vi.fn(), openExternal: vi.fn(), copyCode: vi.fn(),
    defaultCodeLanguage: 'text', copyLabel: 'Copy', copiedLabel: 'Copied',
    copyCodeLabel: (language) => `Copy ${language}`, expandCodeLabel: (lines) => `Show ${lines}`,
  }
  return { target, actions, validate }
}

const references: readonly FileReference[] = [
  { path: 'TODO.md', line: 637 }, { path: 'app.ts', line: 12, column: 5 },
  { path: 'package.json', line: 12 }, { path: '__init__.py', line: 120 },
  { path: 'src/natal/__init__.py', line: 120 }, { path: '.env', line: 12 },
  { path: 'schema.prisma', line: 12 }, { path: 'source.custom', line: 12 },
  { path: 'main.rs', line: 12 }, { path: 'script.pl', line: 12 },
  { path: 'Dockerfile', line: 12 }, { path: 'src/组件.tsx', line: 12 },
  { path: '/Users/developer/project/main.swift', line: 12 },
  { path: '/home/developer/project/main.go', line: 12 },
  { path: 'C:\\Users\\开发者\\project\\main.cpp', line: 12 },
  { path: '\\\\server\\share\\project\\main.rs', line: 12 },
]

describe.each(['plain text', 'inline code', 'Markdown link'] as const)('%s file links', (channel) => {
  it.each(references)('validates and opens $path at the requested location', (reference) => {
    const { target, actions, validate } = setup()
    const key = fileReferenceKey(reference)
    const raw = `${reference.path}:${reference.line}${reference.column === undefined ? '' : `:${reference.column}`}`
    const source = channel === 'inline code' ? `\`${raw}\``
      : channel === 'Markdown link' ? `[source](${encodeURI(raw).replaceAll('\\', '%5C')})` : `See ${raw}.`
    renderMarkdown(target, source, actions)
    expect(target.querySelector('.md-file-link')).toBeNull()
    vi.runAllTimers()
    expect(validate).toHaveBeenCalledExactlyOnceWith([key])

    applyReferenceValidation({ resolved: [key], rejected: [] })
    const link = target.querySelector<HTMLElement>('.md-file-link')!
    expect(link).not.toBeNull()
    expect(link.getAttribute('role')).toBe('link')
    expect(link.tabIndex).toBe(0)
    link.click()
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    link.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(actions.openFile).toHaveBeenCalledTimes(3)
    expect(actions.openFile).toHaveBeenLastCalledWith(reference)
    expect(actions.openExternal).not.toHaveBeenCalled()
    // A streaming redraw reuses the verified key without another host request.
    renderMarkdown(target, `${source}\n\nMore text.`, actions)
    vi.runAllTimers()
    expect(target.querySelectorAll('.md-file-link')).toHaveLength(1)
    expect(validate).toHaveBeenCalledTimes(1)
  })
})

it('leaves rejected/missing files inert and resets validation on session changes', () => {
  const { target, actions, validate } = setup()
  const key = fileReferenceKey({ path: 'missing.py', line: 12 })
  renderMarkdown(target, 'missing.py:12', actions)
  vi.runAllTimers()
  expect(validate).toHaveBeenCalledExactlyOnceWith([key])
  applyReferenceValidation({ resolved: [], rejected: [key] })
  expect(target.querySelector('[data-pending-file-ref], .md-file-link')).toBeNull()
  target.click()
  expect(actions.openFile).not.toHaveBeenCalled()
  renderMarkdown(target, 'missing.py:12 updated', actions)
  vi.runAllTimers()
  expect(validate).toHaveBeenCalledTimes(1)
  resetReferenceValidation()
  renderMarkdown(target, 'missing.py:12 next session', actions)
  vi.runAllTimers()
  expect(validate).toHaveBeenCalledTimes(2)
})

it('never sends real URLs or fenced code to workspace validation', () => {
  const { target, actions, validate } = setup()
  renderMarkdown(target, [
    'https://example.com/a.ts:12', 'mailto:a@b.com', 'https://example.com:8080',
    '`https://example.com/a.ts:12`', '`file:///repo/main.py:12`',
    '```text\nmain.ts:12\n```',
  ].join('\n\n'), actions)
  vi.runAllTimers()
  expect(validate).not.toHaveBeenCalled()
  expect(target.querySelector('.md-file-link')).toBeNull()
  target.querySelector<HTMLAnchorElement>('a[href^="https:"]')!.click()
  expect(actions.openExternal).toHaveBeenCalledWith('https://example.com/a.ts:12')
})

it('requires Host confirmation for ambiguous dotted names with numeric suffixes', () => {
  const { target, actions, validate } = setup()
  // A bare host:port and a local filename:line can have identical syntax.
  // Neither unknown extensions nor ambiguous names become links by syntax alone.
  const key = fileReferenceKey({ path: 'example.com', line: 8080 })
  renderMarkdown(target, '`example.com:8080`', actions)
  vi.runAllTimers()
  expect(validate).toHaveBeenCalledExactlyOnceWith([key])
  applyReferenceValidation({ resolved: [], rejected: [key] })
  expect(target.querySelector('.md-file-link')).toBeNull()
  target.click()
  expect(actions.openFile).not.toHaveBeenCalled()
})

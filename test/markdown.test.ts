import { describe, expect, it } from 'vitest'

import { markdownMarkup } from '../src/webview/markdown.js'

describe('markdownMarkup', () => {
  it.each([
    'src/natal/__init__.py:120', '__init__.py:120', 'src/__tests__/app.test.ts:12',
    'C:\\repo\\src\\__init__.py:120', '\\\\server\\share\\main.py:12',
    'C:\\repo\\src\\_private\\main.ts:12',
  ])('keeps file reference characters literal: %s', (source) => {
    expect(markdownMarkup(`See ${source}.`)).toBe(`<p>See ${source}.</p>\n`)
  })

  it('preserves normal Markdown emphasis, links and fenced code', () => {
    expect(markdownMarkup('_ordinary_ **bold** __strong__')).toBe('<p><em>ordinary</em> <strong>bold</strong> <strong>strong</strong></p>\n')
    expect(markdownMarkup('_README.md_')).toBe('<p><em>README.md</em></p>\n')
    expect(markdownMarkup('**src/__init__.py:12**')).toBe('<p><strong>src/__init__.py:12</strong></p>\n')
    expect(markdownMarkup('[source](src/__init__.py:12)')).toBe('<p><a href="src/__init__.py:12">source</a></p>\n')
    expect(markdownMarkup('`src/__init__.py:12`')).toBe('<p><code>src/__init__.py:12</code></p>\n')
    expect(markdownMarkup('```text\nsrc/__init__.py:12\n```')).toContain('<code class="language-text">src/__init__.py:12\n</code>')
  })

  it('renders the message structures used by Harness replies', () => {
    const html = markdownMarkup([
      '# 标题',
      '',
      '- 普通项目',
      '- **强调项目**',
      '',
      '> 引用',
      '',
      '```ts',
      'const answer = 42',
      '```',
      '',
      '| 名称 | 值 |',
      '| --- | --- |',
      '| answer | `42` |',
    ].join('\n'))

    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<strong>强调项目</strong>')
    expect(html).toContain('<blockquote>')
    // highlight.js adds the `hljs` marker class before the language class.
    expect(html).toMatch(/<code class="(?:hljs )?language-ts">/)
    expect(html).toContain('<table>')
  })

  it('keeps raw HTML inert and does not create remote image elements', () => {
    const html = markdownMarkup([
      '<script>alert("unsafe")</script>',
      '',
      '![tracking pixel](https://example.com/pixel.png)',
      '',
      '[unsafe link](javascript:alert%281%29)',
    ].join('\n'))

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('href="javascript:')
  })

  it('linkifies bare web addresses', () => {
    const html = markdownMarkup('查看 https://example.com/docs')

    expect(html).toContain('<a href="https://example.com/docs">https://example.com/docs</a>')
  })
})

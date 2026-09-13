import { describe, expect, it } from 'vitest'

import {
  clearFileReferenceLedger,
  fileExtension,
  fileReferenceKey,
  findFileReferences,
  isRejectedFileReference,
  isVerifiedFileReference,
  looksLikeWebUrl,
  markRejectedFileReferences,
  markResolvedFileReferences,
  parseFileReference,
  referenceFromKey,
} from '../src/webview/file-reference.js'

describe('parseFileReference', () => {
  it.each([
    'TODO.md', 'README.md', 'AGENTS.md', 'app.ts', 'App.tsx', 'main.js', 'view.jsx',
    'server.mjs', 'build.cjs', '__init__.py', 'main.go', 'lib.rs', 'Main.java',
    'main.cpp', 'Program.cs', 'index.php', 'task.rb', 'App.swift', 'main.dart',
    'init.lua', 'analysis.ipynb', 'package.json', 'config.yaml', 'Cargo.toml',
    'styles.css', 'query.sql', 'build.sh', 'build.ps1', 'archive.tar.gz',
    'schema.prisma', 'source.custom', 'foo.generated.dsl', 'script.pl', 'script.fsx',
    '.env', '.gitignore', 'Dockerfile', 'Makefile', 'README', 'LICENSE', '说明.md',
  ])('parses root-level %s with every supported location suffix', (path) => {
    for (const [suffix, location] of [
      [':12', { line: 12 }], [':12:5', { line: 12, column: 5 }],
      [':12-18', { line: 12 }], ['#L12C5-L18C7', { line: 12, column: 5 }],
    ] as const) {
      const source = `${path}${suffix}`
      expect(parseFileReference(source)).toEqual({ path, ...location })
      expect(findFileReferences(source)).toEqual([{ path, ...location, start: 0, end: source.length }])
    }
  })

  it.each([
    '/Users/developer/project/src/main.ts', '/home/developer/project/src/main.py',
    'C:\\Users\\开发者\\project\\src\\main.cpp', 'D:/project/src/main.rs',
    '\\\\server\\share\\project\\main.go', './src/main.ts', '.\\src\\main.ts',
    'src\\__init__.py', 'src/组件.tsx', './data.custom-extension',
  ])('preserves cross-platform path spelling: %s', (path) => {
    const source = `${path}:12:5`
    expect(parseFileReference(source)).toEqual({ path, line: 12, column: 5 })
    expect(findFileReferences(source)).toEqual([{ path, line: 12, column: 5, start: 0, end: source.length }])
  })

  it.each([
    'https://example.com/a.ts:12', 'http://example.com:8080/main.py',
    'mailto:a@b.com', 'file:///Users/a/main.rs:12', 'vscode://file/a.ts:12',
    'command:workbench.action.openSettings', 'custom+scheme:a.ts:12', 'tel:123:4',
    'data:123', '//example.com/main.py:12', 'www.example.com:80',
    '<mailto:a@b.com>', '@https://example.com/a.ts:12', 'https%3A%2F%2Fexample.com%2Fa.ts%3A12',
  ])('still excludes external references after parsing the location: %s', (source) => {
    expect(parseFileReference(source)).toBeUndefined()
  })

  it('unwraps and decodes references without treating drive letters as line numbers', () => {
    expect(parseFileReference('"README.md:12"')).toEqual({ path: 'README.md', line: 12 })
    expect(parseFileReference('@app.ts:12')).toEqual({ path: 'app.ts', line: 12 })
    expect(parseFileReference('src%2Fmain.py%3A12%3A5')).toEqual({ path: 'src/main.py', line: 12, column: 5 })
    expect(parseFileReference('C:\\My Project\\main.ts:12')).toEqual({ path: 'C:\\My Project\\main.ts', line: 12 })
    expect(parseFileReference('/Users/me/My Project/main.ts:12')).toEqual({ path: '/Users/me/My Project/main.ts', line: 12 })
    expect(parseFileReference('%invalid')).toBeUndefined()
  })

  it('parses relative, absolute, Windows, and line-anchor references', () => {
    expect(parseFileReference('src/extension.ts:41:7')).toEqual({ path: 'src/extension.ts', line: 41, column: 7 })
    expect(parseFileReference('/repo/src/app.ts#L12-L18')).toEqual({ path: '/repo/src/app.ts', line: 12 })
    expect(parseFileReference('src/app.ts:12-18')).toEqual({ path: 'src/app.ts', line: 12 })
    expect(parseFileReference('C:\\repo\\src\\app.ts:9:3')).toEqual({ path: 'C:\\repo\\src\\app.ts', line: 9, column: 3 })
    expect(parseFileReference('package.json')).toEqual({ path: 'package.json' })
  })

  it('does not turn external URLs or ordinary labels into workspace links', () => {
    expect(parseFileReference('https://example.com/src/app.ts')).toBeUndefined()
    expect(parseFileReference('reasoning-process')).toBeUndefined()
    expect(findFileReferences('Release v0.4.4 is ready.')).toEqual([])
  })

  it('keeps scheme-less web domains out of file references', () => {
    expect(parseFileReference('www.example.com')).toBeUndefined()
    expect(parseFileReference('docs.example.com/guide')).toBeUndefined()
    expect(parseFileReference('example.com/docs')).toBeUndefined()
  })

  it('ignores root-level URL fragments such as /guide', () => {
    expect(parseFileReference('/guide')).toBeUndefined()
  })

  it('does not auto-link extensionless relative paths like dir/file', () => {
    expect(parseFileReference('dir/file')).toBeUndefined()
    expect(parseFileReference('approve/request-changes')).toBeUndefined()
    expect(parseFileReference('docs/architecture')).toBeUndefined()
    expect(parseFileReference('feature/foo')).toBeUndefined()
    expect(parseFileReference('release/0.5.5')).toBeUndefined()
    expect(findFileReferences('The change lives under dir/file, keep it there.')).toEqual([])
    expect(findFileReferences('please approve/request-changes for the release')).toEqual([])
  })

  it('keeps extension, dotfile, and known extensionless references clickable', () => {
    expect(parseFileReference('dir/file.ts')).toEqual({ path: 'dir/file.ts' })
    expect(parseFileReference('src/ui/App.TSX:41:7')).toEqual({ path: 'src/ui/App.TSX', line: 41, column: 7 })
    expect(parseFileReference('dir/.env')).toEqual({ path: 'dir/.env' })
    expect(parseFileReference('dir/.gitignore')).toEqual({ path: 'dir/.gitignore' })
    expect(parseFileReference('Makefile')).toEqual({ path: 'Makefile' })
    expect(parseFileReference('README')).toEqual({ path: 'README' })
  })

  it('keeps positional anchors clickable even without an extension', () => {
    expect(parseFileReference('dir/file:12')).toEqual({ path: 'dir/file', line: 12 })
    expect(parseFileReference('dir/file:12:3')).toEqual({ path: 'dir/file', line: 12, column: 3 })
    expect(parseFileReference('docs/guide#L4')).toEqual({ path: 'docs/guide', line: 4 })
  })
})

describe('looksLikeWebUrl', () => {
  it('flags domain-shaped values', () => {
    expect(looksLikeWebUrl('www.example.com')).toBe(true)
    expect(looksLikeWebUrl('docs.example.com/guide')).toBe(true)
    expect(looksLikeWebUrl('example.com/docs')).toBe(true)
    expect(looksLikeWebUrl('https://example.com')).toBe(true)
  })

  it('leaves local file paths and bare source files alone', () => {
    expect(looksLikeWebUrl('src/app.ts')).toBe(false)
    expect(looksLikeWebUrl('package.json')).toBe(false)
    expect(looksLikeWebUrl('file.tar.gz')).toBe(false)
    expect(looksLikeWebUrl('.gitignore')).toBe(false)
  })
})

describe('findFileReferences', () => {
  it.each(['.', ',', ';', '!', '?', ')', '。', '，'])('keeps punctuation after a line number outside the reference: %s', (punctuation) => {
    expect(findFileReferences(`See app.ts:12${punctuation}`)).toEqual([{ path: 'app.ts', line: 12, start: 4, end: 13 }])
  })

  it('locates clickable references in ordinary model prose', () => {
    const source = 'Update src/ui/view.ts:27, then verify package.json.'

    expect(findFileReferences(source)).toEqual([
      { path: 'src/ui/view.ts', line: 27, start: 7, end: 24 },
      { path: 'package.json', start: 38, end: 50 },
    ])
  })

  it('does not surface web-URL fragments as file references', () => {
    expect(findFileReferences('参考 docs.example.com/guide 与 example.com 文档')).toEqual([])
    expect(findFileReferences('https://example.com/a.ts:12 mailto:a@b.com file:///repo/a.py:12')).toEqual([])
    expect(findFileReferences('invalid.ts:12:bad READMEextra')).toEqual([])
  })
})

describe('fileExtension', () => {
  it('extracts the lowercase extension used for file-type icons', () => {
    expect(fileExtension('src/ui/App.TSX')).toBe('tsx')
    expect(fileExtension('manifest.test.ts')).toBe('ts')
    expect(fileExtension('C:\\repo\\styles.css')).toBe('css')
  })

  it('returns nothing for dotfiles, extensionless names, and odd suffixes', () => {
    expect(fileExtension('.gitignore')).toBeUndefined()
    expect(fileExtension('Makefile')).toBeUndefined()
    expect(fileExtension('src/dir.with.dot/')).toBeUndefined()
    expect(fileExtension('archive.tar.gz')).toBe('gz')
  })
})

describe('fileReferenceKey round-trip', () => {
  it('serializes any reference unambiguously, even paths containing pipes', () => {
    const reference = { path: 'src/we|rd/edge-case.ts', line: 42, column: 7 }
    const key = fileReferenceKey(reference)
    expect(referenceFromKey(key)).toEqual(reference)
  })

  it('tolerates missing line/column and rejects malformed keys', () => {
    expect(referenceFromKey(fileReferenceKey({ path: 'src/app.ts' }))).toEqual({ path: 'src/app.ts' })
    expect(referenceFromKey('not-json')).toBeUndefined()
    expect(referenceFromKey('["", null, null]')).toBeUndefined()
    expect(referenceFromKey('[42, null, null]')).toBeUndefined()
    expect(referenceFromKey('{}')).toBeUndefined()
  })

  it('ignores non-positive line/column values', () => {
    expect(referenceFromKey('["a.ts", 0, null]')).toEqual({ path: 'a.ts' })
    expect(referenceFromKey('["a.ts", 1.5, null]')).toEqual({ path: 'a.ts' })
    expect(referenceFromKey('["a.ts", null, -2]')).toEqual({ path: 'a.ts' })
  })
})

describe('existence ledger', () => {
  it('tracks resolved and rejected references independently', () => {
    clearFileReferenceLedger()
    const a = fileReferenceKey({ path: 'src/a.ts' })
    const b = fileReferenceKey({ path: 'src/b.ts' })
    markResolvedFileReferences([a])
    markRejectedFileReferences([b])
    expect(isVerifiedFileReference(a)).toBe(true)
    expect(isRejectedFileReference(a)).toBe(false)
    expect(isVerifiedFileReference(b)).toBe(false)
    expect(isRejectedFileReference(b)).toBe(true)
  })

  it('moves a reference between states when the host re-answers', () => {
    clearFileReferenceLedger()
    const key = fileReferenceKey({ path: 'src/a.ts' })
    markRejectedFileReferences([key])
    markResolvedFileReferences([key])
    expect(isVerifiedFileReference(key)).toBe(true)
    expect(isRejectedFileReference(key)).toBe(false)
  })

  it('clears everything for a session switch', () => {
    clearFileReferenceLedger()
    const key = fileReferenceKey({ path: 'src/a.ts' })
    markResolvedFileReferences([key])
    clearFileReferenceLedger()
    expect(isVerifiedFileReference(key)).toBe(false)
    expect(isRejectedFileReference(key)).toBe(false)
  })
})

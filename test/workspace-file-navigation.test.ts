import * as nodePath from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseFileReference } from '../src/webview/file-reference.js'

afterEach(() => {
  vi.doUnmock('vscode')
  vi.doUnmock('node:path')
  vi.resetModules()
})

// Exercise the real Host service with each platform's path implementation.
// VS Code's UI/filesystem is mocked; these are not native OS end-to-end tests.
describe.each([
  { platform: 'macOS', root: '/Users/developer/repo', paths: nodePath.posix },
  { platform: 'Linux', root: '/home/developer/repo', paths: nodePath.posix },
  { platform: 'Windows', root: 'C:\\Users\\开发者\\repo', paths: nodePath.win32 },
  { platform: 'Windows UNC', root: '\\\\server\\share\\repo', paths: nodePath.win32 },
])('$platform file navigation', ({ root, paths }) => {
  it('validates real files and opens the same location from relative and native absolute references', async () => {
    const { service, openDocument, editor, files } = await hostFixture(root, paths)
    try {
      for (const file of files) {
        const absolute = paths.join(root, file)
        for (const raw of [file, absolute]) {
          const reference = parseFileReference(`${raw}:12:5`)!
          expect(reference).toBeDefined()
          expect(await service.referenceExists(reference)).toBe(true)
          expect(await service.open(reference)).toBe(true)
          expect(openDocument.mock.lastCall?.[0].fsPath).toBe(absolute)
          expect(editor.selection).toEqual({ start: { line: 11, character: 4 }, end: { line: 11, character: 4 } })
          expect(editor.revealRange).toHaveBeenLastCalledWith(editor.selection, 0)
        }
      }
    } finally {
      service.dispose()
    }
  })

  it('keeps missing files and paths outside the workspace inert', async () => {
    const { service, openDocument } = await hostFixture(root, paths)
    try {
      for (const path of ['missing.py', '../outside.ts', paths.resolve(root, '..', 'outside.ts')]) {
        expect(await service.referenceExists({ path, line: 12 })).toBe(false)
        expect(await service.open({ path, line: 12 })).toBe(false)
      }
      expect(openDocument).not.toHaveBeenCalled()
    } finally {
      service.dispose()
    }
  })
})

async function hostFixture(root: string, paths: typeof nodePath.posix) {
  vi.resetModules()
  vi.doMock('node:path', () => paths)
  const files = ['README.md', 'main.ts', '__init__.py', 'package.json', '.env', 'Dockerfile', 'src/组件.tsx']
  const uri = (path: string) => {
    const fsPath = paths.resolve(path)
    return { scheme: 'file', authority: '', fsPath, path: fsPath.replaceAll('\\', '/'), toString: () => `file:${fsPath}` }
  }
  const folder = { name: 'repo', uri: uri(root) }
  const knownFiles = new Set(files.map((file) => paths.join(root, file)))
  // An existing out-of-workspace file must still fail the containment check.
  knownFiles.add(paths.resolve(root, '..', 'outside.ts'))
  const editor = { selection: undefined as unknown, revealRange: vi.fn() }
  const openDocument = vi.fn(async (file: ReturnType<typeof uri>) => ({
    uri: file, lineCount: 100, lineAt: () => ({ text: 'A sufficiently long source line' }),
  }))
  const event = () => ({ dispose() {} })
  class Position { constructor(readonly line: number, readonly character: number) {} }
  class Range { constructor(readonly start: Position, readonly end: Position) {} }
  vi.doMock('vscode', () => ({
    Uri: { file: uri }, Position, Range, Selection: Range,
    FileType: { Directory: 2 }, TextEditorRevealType: { InCenterIfOutsideViewport: 0 },
    workspace: {
      workspaceFolders: [folder], onDidCreateFiles: event, onDidDeleteFiles: event, onDidRenameFiles: event,
      findFiles: async () => files.map((file) => uri(paths.join(root, file))),
      getWorkspaceFolder: (candidate: ReturnType<typeof uri>) => {
        const relative = paths.relative(root, candidate.fsPath)
        return relative === '' || (!relative.startsWith(`..${paths.sep}`) && relative !== '..' && !paths.isAbsolute(relative)) ? folder : undefined
      },
      fs: { stat: async (candidate: ReturnType<typeof uri>) => {
        if (!knownFiles.has(candidate.fsPath)) throw new Error('File not found')
        return { type: 1 }
      } },
      openTextDocument: openDocument,
    },
    window: { showTextDocument: async () => editor },
  }))
  const { WorkspaceFileService } = await import('../src/editor/workspace-file-service.js')
  return { service: new WorkspaceFileService(), openDocument, editor, files }
}

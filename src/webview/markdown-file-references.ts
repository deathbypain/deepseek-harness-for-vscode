import type { MarkdownIt, StateInline } from 'markdown-it'
import { findFileReferences, type LocatedFileReference } from './file-reference.js'

/**
 * Keep file references literal during inline parsing. Markdown's normal text
 * rule may already have consumed a path prefix when it reaches an underscore
 * or backslash, so protect the remaining part of the same candidate too.
 * This prevents __init__.py becoming <strong>init</strong>.py and Windows
 * separators being treated as escapes. No links or trusted HTML are emitted:
 * the existing DOM/Host validation pipeline still decides what is clickable.
 */
export function preserveMarkdownFileReferences(markdown: MarkdownIt): void {
  const candidates = new WeakMap<StateInline, readonly LocatedFileReference[]>()
  markdown.inline.ruler.before('escape', 'workspace_file_reference', (state, silent) => {
    let references = candidates.get(state)
    if (references === undefined) {
      references = findFileReferences(state.src).filter((reference) => {
        // Balanced outer underscores are prose emphasis, not path characters
        // (e.g. _README.md_). Leave those delimiters to Markdown itself.
        const raw = state.src.slice(reference.start, reference.end)
        return !/^(_{1,2}).+\1$/u.test(raw)
      })
      candidates.set(state, references)
    }
    // Inline parsing can rewind while testing link labels, so do not use a
    // forward-only cursor. Binary search also avoids rescanning long messages.
    const reference = containingReference(references, state.pos)
    if (reference === undefined || reference.end > state.posMax) return false
    if (!silent) state.pending += state.src.slice(state.pos, reference.end)
    state.pos = reference.end
    return true
  })
}

function containingReference(references: readonly LocatedFileReference[], position: number): LocatedFileReference | undefined {
  let low = 0
  let high = references.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const reference = references[middle]!
    if (position < reference.start) high = middle - 1
    else if (position >= reference.end) low = middle + 1
    else return reference
  }
  return undefined
}

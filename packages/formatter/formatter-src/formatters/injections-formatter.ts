import { type EmbeddedTsFormatter, formatEmbeddedTs } from '../embedded-ts'
import { findInjectionFenceCloseIndex, type FormatHandlers, isInjectionFenceOpenLine } from '../formatting'

export default {
  /** Injection formats `inject arguments` spacing up to the TS fence. */
  Injection(f) {
    f.oneSpaceAfter('inject')
    f.oneSpaceBeforeProperty('tsCodeBlock')
  },

  /** InjectionArgumentList formats comma-separated injection arguments. */
  InjectionArgumentList(f) {
    f.commaSpacedList()
  },

  /** NamedInjectionArgument formats `Name value` spacing. */
  NamedInjectionArgument(f) {
    f.oneSpaceBeforeProperty('value', 'ambient')
  },

  /** RenderAmbientChannel is an atomic `@@content`, `@@layout`, or `@@tag` token. */
  RenderAmbientChannel() {},

  /** ShorthandInjectionArgument is a single value reference; spacing is owned by InjectionArgumentList commas. */
  ShorthandInjectionArgument() {},
} satisfies Partial<FormatHandlers>

/**
 * reindentInjectionFences re-indents multiline inject fence bodies one tab below the line that opens
 * the fence, with the closing fence at the opening line's indentation. The fence body is one lexer
 * token, so Langium formatting cannot reach inside it and this runs as a text post-pass.
 */
export function reindentInjectionFences(text: string, tab: string, formatter?: EmbeddedTsFormatter): string {
  const lines = text.split('\n')
  const result: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (!isInjectionFenceOpenLine(line)) {
      result.push(line)
      index++
      continue
    }
    const closeIndex = findInjectionFenceCloseIndex(lines, index)
    if (closeIndex === -1) {
      result.push(...lines.slice(index))
      break
    }
    const baseIndent = line.match(/^[ \t]*/)![0]
    const closeLine = lines[closeIndex]!
    const fenceOffset = closeLine.indexOf('```')
    const beforeFence = closeLine.slice(0, fenceOffset)
    const bodyLines = lines.slice(index + 1, closeIndex)
    if (beforeFence.trim() !== '') {
      // Body content sharing the close line moves onto its own line at the body indentation.
      bodyLines.push(beforeFence.trim())
    }
    const formattedBody = formatter
      ? formatEmbeddedTs(bodyLines.join('\n'), { baseIndent, tabSize: tab.length }, formatter)
      : null

    result.push(line)
    if (formattedBody === null) {
      result.push(...reindentLines(bodyLines, baseIndent + tab))
    } else if (formattedBody !== '') {
      result.push(...formattedBody.split('\n'))
    }
    result.push(baseIndent + closeLine.slice(fenceOffset))
    index = closeIndex + 1
  }
  return result.join('\n')
}

function reindentLines(lines: readonly string[], indent: string): string[] {
  const contentLines = lines.filter(line => line.trim() !== '')
  if (contentLines.length === 0) {
    return lines.map(() => '')
  }
  const sharedIndentLength = Math.min(...contentLines.map(line => line.length - line.trimStart().length))
  return lines.map(line => line.trim() === '' ? '' : indent + line.slice(sharedIndentLength))
}

import { findInjectionFenceCloseIndex, type FormatHandlers, isInjectionFenceOpenLine } from '../formatting'

export default {
  /** Block formats `{ }` bodies with one indented statement per line. */
  Block(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
  },

  /** ParameterList formats comma-separated parameter declarations. */
  ParameterList(f) {
    f.commaSpacedList()
  },

  /** ParameterDeclaration formats `Name type` spacing. */
  ParameterDeclaration(f) {
    f.oneSpaceBeforeProperty('type')
  },
} satisfies Partial<FormatHandlers>

/**
 * collapseClosingBraces merges runs of consecutive closing-brace-only lines onto one line at the
 * outermost (last) brace's indentation, with two spaces between braces, per `Spec/Tao Packages.md`.
 * Lines inside inject TS fences are left untouched. Runs as a text post-pass because each Block
 * formats its own `}` and Langium indentation is always block-local.
 */
export function collapseClosingBraces(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    if (isInjectionFenceOpenLine(line)) {
      const closeIndex = findInjectionFenceCloseIndex(lines, index)
      const fenceEnd = closeIndex === -1 ? lines.length - 1 : closeIndex
      result.push(...lines.slice(index, fenceEnd + 1))
      index = fenceEnd + 1
      continue
    }
    let runEnd = index
    while (isClosingBraceLine(lines[runEnd]!) && runEnd + 1 < lines.length && isClosingBraceLine(lines[runEnd + 1]!)) {
      runEnd++
    }
    if (runEnd > index) {
      const indent = lines[runEnd]!.match(/^[ \t]*/)![0]
      result.push(indent + Array.from({ length: runEnd - index + 1 }, () => '}').join('  '))
      index = runEnd + 1
      continue
    }
    result.push(line)
    index++
  }
  return result.join('\n')
}

function isClosingBraceLine(line: string): boolean {
  return /^[ \t]*\}$/.test(line)
}

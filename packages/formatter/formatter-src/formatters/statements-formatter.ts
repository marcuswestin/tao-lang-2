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

  /** ParameterDeclaration formats either a bare named type or an inline `Name is Type` declaration. */
  ParameterDeclaration() {},
} satisfies Partial<FormatHandlers>

/**
 * collapseClosingBraces merges runs of consecutive closing-delimiter-only lines onto one line at the
 * outermost (last) delimiter's indentation, with two spaces between delimiters, per `Spec/Tao Packages.md`.
 * Lines inside inject TS fences and block comments are left untouched. Runs as a text post-pass
 * because each block-like node formats its own closing delimiter and Langium indentation is always
 * block-local.
 */
export function collapseClosingBraces(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  let index = 0
  let inBlockComment = false
  while (index < lines.length) {
    const line = lines[index]!
    if (isInjectionFenceOpenLine(line)) {
      const closeIndex = findInjectionFenceCloseIndex(lines, index)
      const fenceEnd = closeIndex === -1 ? lines.length - 1 : closeIndex
      result.push(...lines.slice(index, fenceEnd + 1))
      index = fenceEnd + 1
      continue
    }
    const blockComment = scanBlockCommentLine(line, inBlockComment)
    if (inBlockComment || blockComment.enteredBlockComment) {
      result.push(line)
      inBlockComment = blockComment.inBlockComment
      index++
      continue
    }
    inBlockComment = blockComment.inBlockComment
    let runEnd = index
    while (
      isClosingDelimiterLine(lines[runEnd]!)
      && runEnd + 1 < lines.length
      && isClosingDelimiterLine(lines[runEnd + 1]!)
    ) {
      runEnd++
    }
    if (runEnd > index) {
      const indent = lines[runEnd]!.match(/^[ \t]*/)![0]
      const delimiters = lines.slice(index, runEnd + 1).map(closingDelimiter)
      result.push(indent + delimiters.join('  '))
      index = runEnd + 1
      continue
    }
    result.push(line)
    index++
  }
  return result.join('\n')
}

function isClosingDelimiterLine(line: string): boolean {
  return /^[ \t]*}$/.test(line)
}

function closingDelimiter(line: string): string {
  return line.trim()
}

function scanBlockCommentLine(
  line: string,
  inBlockComment: boolean,
): { enteredBlockComment: boolean; inBlockComment: boolean } {
  let inside = inBlockComment
  let enteredBlockComment = false
  let insideString = false
  let index = 0
  while (index < line.length) {
    if (inside) {
      const end = line.indexOf('*/', index)
      if (end === -1) {
        return { enteredBlockComment, inBlockComment: true }
      }
      inside = false
      index = end + 2
      continue
    }

    if (insideString) {
      if (line[index] === '\\') {
        index += 2
        continue
      }
      if (line[index] === '"') {
        insideString = false
      }
      index++
      continue
    }

    if (line.startsWith('//', index)) {
      return { enteredBlockComment, inBlockComment: false }
    }
    if (line[index] === '"') {
      insideString = true
      index++
      continue
    }
    if (line.startsWith('/*', index)) {
      enteredBlockComment = true
      inside = true
      index += 2
      continue
    }
    index++
  }
  return { enteredBlockComment, inBlockComment: inside }
}

import { AST } from '@parser'
import { findInjectionFenceCloseIndex, type FormatHandlers, isInjectionFenceOpenLine } from '../formatting'

export default {
  /** Block formats `{ }` bodies with one indented statement per line. */
  Block(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.statements)
    if (AST.isTestDeclaration(f.node.$container)) {
      f.separateIndentedLines(f.node.statements, () => 2)
    }
    if (AST.isCheckDeclaration(f.node.$container)) {
      f.separateIndentedLines(
        f.node.statements,
        (previous, next) => AST.isRunStep(previous) && AST.isExpectTextStep(next) ? 2 : 1,
      )
    }
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
 * Lines inside inject TS fences and block comments are left untouched. Runs as a text post-pass
 * because each Block formats its own `}` and Langium indentation is always block-local.
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
    while (isClosingBraceLine(lines[runEnd]!) && runEnd + 1 < lines.length && isClosingBraceLine(lines[runEnd + 1]!)) {
      runEnd++
    }
    if (runEnd > index) {
      if (isTestClosingBraceRun(lines, index)) {
        result.push(lines[index]!)
        index++
        continue
      }
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

function isTestClosingBraceRun(lines: readonly string[], index: number): boolean {
  const previous = previousNonEmptyLine(lines, index)
  return previous !== undefined && /^[ \t]*(expect|run)\b/.test(previous)
}

function previousNonEmptyLine(lines: readonly string[], index: number): string | undefined {
  for (let lineIndex = index - 1; lineIndex >= 0; lineIndex--) {
    const line = lines[lineIndex]!
    const trimmed = line.trim()
    if (trimmed !== '' && !trimmed.startsWith('//')) {
      return line
    }
  }
  return undefined
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

import { AST } from '@parser'
import {
  collapsesToOneLine,
  findInjectionFenceCloseIndex,
  type FormatHandlers,
  isInjectionFenceOpenLine,
} from '../formatting'

export default {
  /** Block formats `{ }` bodies with one indented statement per line. */
  Block(f) {
    f.oneSpaceBefore('{')
    // A conditional branch reads as one line when its body is a single statement that fits.
    if (isConditionalBranch(f.node.$container) && collapsesToOneLine(f.node, f.node.statements)) {
      f.singleLineBraceBlock(f.node.statements[0]!)
      return
    }
    f.indentedBraceBlock(f.node.statements)
    // A tag names the element below it, so it reads as that element's opening line rather than as
    // one more statement in the run above it.
    if (!AST.isTestDeclaration(f.node.$container)) {
      f.separateIndentedLines(f.node.statements, (_previous, next) => AST.isTagStatement(next) ? 2 : 1)
    }
    if (AST.isTestDeclaration(f.node.$container)) {
      f.separateIndentedLines(f.node.statements, () => 2)
    }
    if (AST.isTestDeclaration(f.node.$container)) {
      f.separateIndentedLines(
        f.node.statements,
        (previous, next) =>
          AST.isRunStep(previous) && (AST.isExpectTextStep(next) || AST.isExpectCheckboxStateStep(next)) ? 2 : 1,
      )
    }
  },

  /** ParameterList formats comma-separated parameter declarations. */
  ParameterList(f) {
    f.commaSpacedList()
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** ParameterDeclaration formats either a bare named type or an inline `Name is Type` declaration. */
  ParameterDeclaration(f) {
    f.oneSpaceBeforeProperty('defaultValue')
  },

  /** ParameterTypeDeclaration separates a renamed parameter from the type it takes. */
  ParameterTypeDeclaration(f) {
    f.oneSpaceBeforeProperty('type')
  },

  /** WhenRenderStatement puts each branch and its required fallback on an indented line. */
  WhenRenderStatement(f) {
    f.oneSpaceAfter('when')
    f.oneSpaceBefore('{')
    f.indentedBraceBlock([...f.node.branches, f.node.otherwise])
    f.lineSeparatedList([...f.node.branches, f.node.otherwise])
  },

  /** WhenRenderBranch spaces its condition against the branch arrow. */
  WhenRenderBranch(f) {
    f.oneSpaceBefore('->')
    if (f.node.payload !== undefined) {
      f.oneSpaceAfter('->')
    }
  },

  /** WhenRenderOtherwise spaces the fallback keyword against the branch arrow. */
  WhenRenderOtherwise(f) {
    f.oneSpaceBefore('->')
  },

  /** IfRenderStatement separates its boolean condition from its one-sided child block. */
  IfRenderStatement(f) {
    f.oneSpaceAfter('if')
  },

  /** GuardRenderStatement separates its subject from either single or grouped cases. */
  GuardRenderStatement(f) {
    f.oneSpaceAfter('guard')
    f.oneSpaceBeforeProperty('caseBlock', 'single')
  },

  /** GuardRenderCaseBlock puts each case on one indented line. */
  GuardRenderCaseBlock(f) {
    f.indentedBraceBlock(f.node.branches)
    f.lineSeparatedList(f.node.branches)
  },

  /** GuardRenderBranch formats its optional handler and error payload. */
  GuardRenderBranch(f) {
    f.oneSpaceBefore('->')
    if (f.node.payload !== undefined) {
      f.oneSpaceAfter('->')
    }
  },

  /** EventHandler formats control configuration as `on event Action` or an inline handler. */
  EventHandler(f) {
    f.oneSpaceAfter('on')
    f.oneSpaceBefore('->')
    f.oneSpaceBeforeProperty('action')
    if (f.node.payload !== undefined) {
      f.oneSpaceAfter('->')
    }
  },

  /** LoopSelectHandler formats loop-owned inline selection actions without widening ordinary events. */
  LoopSelectHandler(f) {
    f.oneSpaceAfter('on')
    f.oneSpaceBefore('->')
    f.oneSpaceBeforeProperty('action')
  },

  /** ForStatement formats iteration headers. */
  ForStatement(f) {
    f.oneSpaceAfter('loop')
    f.oneSpaceAround('/')
  },
} satisfies Partial<FormatHandlers>

/**
 * collapseClosingBraces merges runs of consecutive closing-delimiter-only lines onto one line at the
 * outermost (last) delimiter's indentation, with two spaces between delimiters, per `Docs/Spec/Tao Packages.md`.
 * Lines inside inject TS fences and block comments are left untouched. Runs as a text post-pass
 * because each block-like node formats its own closing delimiter and Langium indentation is always
 * block-local.
 */
export function collapseClosingBraces(text: string): string {
  const lines = text.split('\n')
  const designLines = linesInsideDesign(lines)
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
      if (designLines[index] || isTestClosingBraceRun(lines, index)) {
        result.push(lines[index]!)
        index++
        continue
      }
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

/** Structured design blocks retain one owned closing brace per line so nested typed blocks stay unambiguous. */
function linesInsideDesign(lines: readonly string[]): readonly boolean[] {
  const result: boolean[] = []
  let depth = 0
  for (const line of lines) {
    const source = line.replace(/\/\/.*$/, '')
    if (depth === 0 && /^\s*design\s+[A-Za-z_]\w*\s*\{/.test(source)) {
      depth = braceDelta(source)
      result.push(true)
      continue
    }
    result.push(depth > 0)
    if (depth > 0) {
      depth += braceDelta(source)
    }
  }
  return result
}

function braceDelta(line: string): number {
  return [...line].reduce((depth, character) => depth + (character === '{' ? 1 : character === '}' ? -1 : 0), 0)
}

function isClosingDelimiterLine(line: string): boolean {
  return /^[ \t]*}$/.test(line)
}

function closingDelimiter(line: string): string {
  return line.trim()
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

function isConditionalBranch(container: AST.Node | undefined): boolean {
  return container !== undefined
    && (AST.isGuardRenderBranch(container)
      || AST.isWhenRenderBranch(container)
      || AST.isWhenRenderOtherwise(container))
}

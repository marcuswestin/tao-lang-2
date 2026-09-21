import { AST } from '@parser'
import { collapsesToOneLine, type FormatHandlers } from '../formatting'

export const StatementsFormatter = {
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

function isConditionalBranch(container: AST.Node | undefined): boolean {
  return container !== undefined
    && (AST.isGuardRenderBranch(container)
      || AST.isWhenRenderBranch(container)
      || AST.isWhenRenderOtherwise(container))
}

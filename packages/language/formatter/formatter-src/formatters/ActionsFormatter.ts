import { AST } from '@parser'
import { collapsesToOneLine, type FormatHandlers } from '../formatting'

export const ActionsFormatter = {
  DeferStatement(f) {
    if (f.node.invocation) {
      f.oneSpaceAfter('defer')
    }
  },
  RetryStatement(f) {
    f.oneSpaceAfter('retry')
  },
  /** ActionBlock formats action bodies with one indented statement per line. */
  ActionBlock(f) {
    if (!f.node.$cstNode?.text.startsWith('{')) {
      return
    }
    f.oneSpaceBefore('{')
    // The inline `-> { … }` shapes, `when do` outcomes among them, collapse; a named action, `async`,
    // and control-flow bodies keep their own lines. A comment inside would swallow the closing braces,
    // so it holds the block open.
    const canUseSingleLineActionBody = isInlineActionBody(f.node.$container)
      && collapsesToOneLine(f.node, f.node.statements)
    if (canUseSingleLineActionBody) {
      f.singleLineBraceBlock(f.node.statements[0]!)
      return
    }
    f.indentedBraceBlock(f.node.statements)
  },

  /** ActionDeclaration formats a named action header and body. */
  ActionDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('action')
    f.noSpaceBefore('(')
    f.oneSpaceBefore('returns')
    f.oneSpaceAfter('returns')
    f.noSpaceBefore('?')
    f.oneSpaceBefore('runs')
    f.oneSpaceAfter('runs')
  },

  /** ForeignActionImplementation keeps declared failures in the action head before its module. */
  ForeignActionImplementation(f) {
    f.oneSpaceBefore('fails', 'from')
    f.oneSpaceAfter('from')
  },

  /** ActionFailureDeclaration separates the case and user-facing sentence. */
  ActionFailureDeclaration(f) {
    f.oneSpaceBefore('fails')
    f.oneSpaceAfter('fails')
    f.oneSpaceBeforeProperty('sentence')
  },

  /** FailStatement separates its case and user-facing sentence. */
  FailStatement(f) {
    f.oneSpaceAfter('fail')
    f.oneSpaceBeforeProperty('sentence')
  },

  /** CommandDeclaration formats a command head as a view's: its parameter list hugs the name. */
  CommandDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('command')
    f.noSpaceBefore('(')
    f.oneSpaceBeforeProperty('block')
  },

  /** CommandBlock puts every member fill and the do clause on one indented line each. */
  CommandBlock(f) {
    f.indentedBraceBlock(f.node.members)
    f.lineSeparatedList(f.node.members)
  },

  /** CommandFill separates a member name from the value it binds. */
  CommandFill(f) {
    f.oneSpaceBeforeProperty('value')
  },

  /** CommandDoClause formats the one invocation a command binds. */
  CommandDoClause(f) {
    f.oneSpaceAfter('do')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** DeclarationSlotFill separates the slot name from its expression or reference block. */
  DeclarationSlotFill(f) {
    f.oneSpaceBeforeProperty('value', 'block')
  },

  /** DeclarationSlotReferenceBlock formats referenced commands as an indented list. */
  DeclarationSlotReferenceBlock(f) {
    f.noSpaceBefore(',')
    f.oneSpaceBeforeProperty('references')
    f.oneSpaceBefore('}')
  },

  /** ActionExpression formats inline action bodies. */
  ActionExpression() {},

  /** AsyncActionStatement delegates keyword-to-block spacing to ActionBlock. */
  AsyncActionStatement() {},

  /** ToggleStatement formats state or stored yes/no field inversion. */
  ToggleStatement(f) {
    f.oneSpaceAfter('toggle')
  },

  /** GuardActionStatement separates its subject from either single or grouped cases. */
  GuardActionStatement(f) {
    f.oneSpaceAfter('guard')
    f.oneSpaceBeforeProperty('caseBlock', 'single')
  },

  /** GuardActionCaseBlock puts each case on one indented line. */
  GuardActionCaseBlock(f) {
    f.indentedBraceBlock(f.node.branches)
    f.lineSeparatedList(f.node.branches)
  },

  /** GuardActionBranch formats its optional handler and error payload. */
  GuardActionBranch(f) {
    f.oneSpaceBefore('->')
    if (f.node.payload !== undefined) {
      f.oneSpaceAfter('->')
    }
  },

  /** CheckStatement separates the keyword from its boolean condition. */
  CheckStatement(f) {
    f.oneSpaceAfter('check')
  },

  /** IfActionStatement separates its boolean condition from its one-sided body. */
  IfActionStatement(f) {
    f.oneSpaceAfter('if')
  },

  /** DoStatement formats invocation spacing, for an action and a command alike. */
  DoStatement(f) {
    f.oneSpaceAfter('do')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
    if (f.node.then) {
      const outcomes = [...f.node.outcomes, ...(f.node.otherwise ? [f.node.otherwise] : [])]
      f.oneSpaceBefore('then')
      if (f.node.otherwise?.barSyntax) {
        f.indentedLines(outcomes)
        return
      }
      f.oneSpaceBefore('{')
      f.indentedBraceBlock(outcomes)
      f.lineSeparatedList(outcomes)
    }
  },

  /** WhenDoStatement puts its invocation on the `when` line and each outcome on its own line. */
  WhenDoStatement(f) {
    f.oneSpaceAfter('when')
    if (f.node.otherwise?.barSyntax) {
      f.indentedLines([...f.node.outcomes, f.node.otherwise])
      return
    }
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.outcomes)
    f.lineSeparatedList(f.node.outcomes)
  },

  /** WhenDoOutcome separates the outcome from its optional message name and its block. */
  WhenDoOtherwise(f) {
    f.oneSpaceAfter('|')
    f.oneSpaceBefore('->')
    if (!f.node.block.$cstNode?.text.startsWith('{')) {
      f.oneSpaceAfter('->')
    }
  },

  WhenDoOutcome(f) {
    f.oneSpaceAfter('|')
    f.oneSpaceBefore('->')
    if (!f.node.block.$cstNode?.text.startsWith('{')) {
      f.oneSpaceAfter('->')
    }
    if (f.node.payload !== undefined) {
      f.oneSpaceAfter('->')
    }
  },

  ActionResultStatement(f) {
    f.oneSpaceAfter('let')
    f.oneSpaceBefore('=')
    f.oneSpaceAfter('=')
  },

  /** AskStatement formats its local binding and dialogue invocation. */
  AskStatement(f) {
    f.oneSpaceAfter('let', 'ask')
    f.oneSpaceBefore('=')
    f.oneSpaceAfter('=')
    f.noSpaceBefore('(')
    f.noSpaceAfter('(')
    f.noSpaceBefore(')')
  },

  /** RespondStatement separates an optional declared response case. */
  RespondStatement(f) {
    if (f.node.case) {
      f.oneSpaceAfter('respond')
    }
  },
} satisfies Partial<FormatHandlers>

function isInlineActionBody(container: AST.Node): boolean {
  return AST.isActionExpression(container)
    || AST.isEventHandler(container)
    || AST.isLoopSelectHandler(container)
    || AST.isWhenDoOutcome(container)
}

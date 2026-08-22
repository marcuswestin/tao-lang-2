import { AST } from '@parser'
import { Assert } from '@shared'

/** bridgedExpressionsOf returns every `<expression> from <path>` in one generated source module. */
export function bridgedExpressionsOf(file: AST.TaoFile): AST.FromExpression[] {
  return [...AST.streamAllContents(file).filter(AST.isFromExpression)]
}

/** bridgeBindingName returns the private import alias one bridged expression uses. */
export function bridgeBindingName(bridge: AST.FromExpression): string {
  const root = AST.findRoot(bridge)
  Assert.is(root, AST.isTaoFile, 'bridged expression is owned by a Tao file')
  const index = bridgedExpressionsOf(root).indexOf(bridge)
  Assert(index >= 0, 'bridged expression appears in its owning Tao file')
  return `__tao_bridge_${index + 1}__`
}

/** bridgeExportName returns the named export a bridged expression calls or reads. */
export function bridgeExportName(bridge: AST.FromExpression): string {
  const expression = bridge.expression
  if (AST.isFunctionCallExpression(expression)) {
    return expression.function.$refText
  }
  Assert.is(expression, AST.isValueReference, 'validated bridged expression names one export')
  return expression.target.$refText
}

/** InlineInjection is authored TypeScript that the compiler emits as an isolated module. */
export type InlineInjection = AST.Injection

let activeBindings: ReadonlyMap<InlineInjection, string> | undefined

/** inlineInjectionsOf returns every inline implementation emitted by one generated source module. */
export function inlineInjectionsOf(file: AST.TaoFile): InlineInjection[] {
  const injections = AST.streamAllContents(file).filter(isInlineInjection)
  return injections
}

/** inlineInjectionBindingName returns the private import name used by the owning generated module. */
export function inlineInjectionBindingName(injection: InlineInjection): string {
  const active = activeBindings?.get(injection)
  if (active !== undefined) {
    return active
  }
  const root = AST.findRoot(injection)
  Assert.is(root, AST.isTaoFile, 'inline injection is owned by a Tao file')
  const index = inlineInjectionsOf(root).indexOf(injection)
  Assert(index >= 0, 'inline injection appears in its owning Tao file')
  return `__tao_injection_${index + 1}__`
}

/** withInlineInjectionBindings scopes node identities to one synchronous generated module pass. */
export function withInlineInjectionBindings<ResultT>(
  bindings: ReadonlyMap<InlineInjection, string>,
  generate: () => ResultT,
): ResultT {
  const previous = activeBindings
  activeBindings = bindings
  try {
    return generate()
  } finally {
    activeBindings = previous
  }
}

function isInlineInjection(node: AST.Node): node is InlineInjection {
  return AST.isInjection(node)
}

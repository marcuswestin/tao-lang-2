import { AST } from '@parser'
import { type AssociatedCapabilityWitness, type TaoType, Type } from './Type'

type RenderValueSource =
  | AST.AliasDeclaration
  | AST.StateDeclaration
  | AST.ParameterDeclaration
  | AST.RenderSlotInputBinding
  | AST.ForStatement
  | AST.Expression

/**
 * RenderTarget classifies what a render site names. A view declaration is invoked with arguments;
 * admitted ui values invoke their selected render witness and rendered descriptions mount directly.
 * Text values render as text; nav declarations and visual parameters retain their bound occurrence.
 */
export type RenderTarget =
  | { kind: 'view'; view: AST.ViewDeclaration }
  | { kind: 'nav'; declaration: AST.NavDeclaration }
  | {
    kind: 'text'
    declaration:
      | AST.AliasDeclaration
      | AST.StateDeclaration
      | AST.ParameterDeclaration
      | AST.RenderSlotInputBinding
      | AST.ForStatement
    expression?: undefined
  }
  | { kind: 'text'; expression: AST.Expression; declaration?: undefined }
  | { kind: 'rendered'; source: RenderValueSource }
  | {
    kind: 'ui'
    source: RenderValueSource
    actual: TaoType
    contract: TaoType
    witness: AssociatedCapabilityWitness
  }
  | {
    kind: 'parameter'
    parameter: AST.ParameterDeclaration | AST.RenderSlotInputBinding
    family: 'view' | 'scene' | 'nav'
  }

/** resolveRenderTarget classifies the linked target of one render site. */
export function resolveRenderTarget(render: AST.Render): RenderTarget | undefined {
  if (render.expression) {
    const type = Type.ofExpression(render.expression)
    const visual = resolveVisualValue(render, render.expression, type)
    if (visual) {
      return visual
    }
    return type.kind === 'primitive' && type.primitive === 'text'
      ? { kind: 'text', expression: render.expression }
      : undefined
  }
  const target = render.view?.ref
  if (!target) {
    return undefined
  }
  if (AST.isViewDeclaration(target)) {
    return { kind: 'view', view: target }
  }
  if (AST.isNavDeclaration(target)) {
    return { kind: 'nav', declaration: target }
  }
  if (!AST.isValueDeclaration(target)) {
    return undefined
  }
  const type = Type.ofValueDeclaration(target, render)
  const visual = resolveVisualValue(render, target, type)
  if (visual) {
    return visual
  }
  if (type.kind === 'primitive' && type.primitive === 'text') {
    return { kind: 'text', declaration: target }
  }
  if (!AST.isParameterDeclaration(target) && !AST.isRenderSlotInputBinding(target)) {
    return undefined
  }
  const parameterType = type
  if (
    parameterType.kind !== 'primitive'
    || (parameterType.primitive !== 'view' && parameterType.primitive !== 'scene' && parameterType.primitive !== 'nav')
  ) {
    return undefined
  }
  const family = parameterType.primitive === 'scene' || parameterType.primitive === 'nav'
    ? parameterType.primitive
    : 'view'
  return { kind: 'parameter', parameter: target, family }
}

/** The ordinary package contract selects a sealed witness before any text fallback. */
function resolveVisualValue(render: AST.Render, source: RenderValueSource, actual: TaoType): RenderTarget | undefined {
  if (actual.kind === 'primitive' && actual.primitive === 'rendered') {
    return { kind: 'rendered', source }
  }
  const root = AST.findRoot(render)
  if (!AST.isTaoFile(root)) {
    return undefined
  }
  const file = AST.workspaceFilesFor(root).find(file => AST.getDocument(file).uri.path.endsWith('/@tao/ui/UI.tao'))
  const declaration = file?.statements.filter(AST.isTypeDeclaration).find(declaration => declaration.name === 'ui')
  if (!declaration) {
    return undefined
  }
  const contract = Type.ofDefinition(declaration)
  if (contract.kind !== 'capability') {
    return undefined
  }
  const witness = Type.capabilityWitnesses(actual, contract)?.find(witness =>
    witness.required.owner === declaration
    && witness.required.signature.inputs.length === 0
    && witness.required.result.kind === 'primitive' && witness.required.result.primitive === 'rendered'
  )
  return witness ? { kind: 'ui', source, actual, contract, witness } : undefined
}

/** renderTargetName returns the name a diagnostic uses for one render target. */
export function renderTargetName(target: RenderTarget): string {
  if (target.kind === 'ui' || target.kind === 'rendered') {
    return AST.isExpression(target.source)
      ? target.source.$cstNode?.text ?? 'expression'
      : AST.isRenderSlotInputBinding(target.source)
      ? target.source.name
      : Type.declarationName(target.source)
  }
  return target.kind === 'view'
    ? target.view.name
    : target.kind === 'nav'
    ? target.declaration.name
    : target.kind === 'text'
    ? target.expression !== undefined
      ? target.expression.$cstNode?.text ?? 'expression'
      : AST.isRenderSlotInputBinding(target.declaration)
      ? target.declaration.name
      : Type.declarationName(target.declaration)
    : AST.isRenderSlotInputBinding(target.parameter)
    ? target.parameter.name
    : Type.parameterName(target.parameter)
}

/** renderTargetIsNav reports a render site that mounts a navigator: a nav declaration or a nav-typed parameter. */
export function renderTargetIsNav(target: RenderTarget): boolean {
  return target.kind === 'nav' || (target.kind === 'parameter' && target.family === 'nav')
}

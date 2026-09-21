import { AST } from '@parser'
import { Type } from './Type'

/**
 * RenderTarget classifies what a render site names. A view declaration is invoked with arguments;
 * a nav declaration or a view-, scene-, or nav-typed parameter renders as the value it was bound to.
 */
export type RenderTarget =
  | { kind: 'view'; view: AST.ViewDeclaration }
  | { kind: 'nav'; declaration: AST.NavDeclaration }
  | { kind: 'parameter'; parameter: AST.ParameterDeclaration; family: 'view' | 'scene' | 'nav' }

/** resolveRenderTarget classifies the linked target of one render site. */
export function resolveRenderTarget(render: AST.Render): RenderTarget | undefined {
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
  const type = Type.ofParameter(target)
  const family = type.kind === 'primitive' && (type.primitive === 'scene' || type.primitive === 'nav')
    ? type.primitive
    : 'view'
  return { kind: 'parameter', parameter: target, family }
}

/** renderTargetName returns the name a diagnostic uses for one render target. */
export function renderTargetName(target: RenderTarget): string {
  return target.kind === 'view'
    ? target.view.name
    : target.kind === 'nav'
    ? target.declaration.name
    : Type.parameterName(target.parameter)
}

/** renderTargetIsNav reports a render site that mounts a navigator: a nav declaration or a nav-typed parameter. */
export function renderTargetIsNav(target: RenderTarget): boolean {
  return target.kind === 'nav' || (target.kind === 'parameter' && target.family === 'nav')
}

import { AST } from '@parser'

/** rootAppValue walks app value refinement/reference chains to the root concrete app declaration.
 * Returns undefined when the derivation chain is cyclic. */
export function rootAppValue(app: AST.AppValueDeclaration): AST.AppValueDeclaration | undefined {
  return rootAppValueFrom(app, new Set())
}

function rootAppValueFrom(
  app: AST.AppValueDeclaration,
  seen: Set<AST.AppValueDeclaration>,
): AST.AppValueDeclaration | undefined {
  if (seen.has(app)) {
    return undefined
  }
  seen.add(app)
  const expression = app.value
  if (AST.isRefinementExpression(expression) || AST.isValueReference(expression)) {
    const target = expression.target.ref
    if (AST.isConcreteAppValueDeclaration(target)) {
      return rootAppValueFrom(target, seen)
    }
  }
  return app
}

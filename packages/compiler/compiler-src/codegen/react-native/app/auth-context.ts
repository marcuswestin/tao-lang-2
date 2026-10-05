import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type Compiled, gen } from '../codegen-util'
import { activeDataStorePlan } from './data-store-context'

/** Auth exports are identified by their owning library, never by an application's local names. */
export function authLibraryExport(node: AST.Node): string | undefined {
  const root = AST.findRoot(node)
  if (!AST.isTaoFile(root) || !AST.getDocument(root).uri.path.endsWith('/@tao/auth/Auth.tao')) {
    return undefined
  }
  return 'name' in node && typeof node.name === 'string' ? node.name : undefined
}

/** Module values that touch app data become factories so simultaneous mounts never share a caller. */
export function needsAuthContext(node: AST.Node, seen = new Set<AST.Node>()): boolean {
  if (seen.has(node)) {
    return false
  }
  seen.add(node)
  if (authLibraryExport(node)) {
    return true
  }
  for (const child of [node, ...AST.streamAllContents(node)]) {
    if (AST.isCreateStatement(child) || AST.isEntityQueryDeclaration(child)) {
      return true
    }
    if (AST.isMemberAccessExpression(child) || AST.isPostfixMemberAccess(child)) {
      const selected = ASTUtils.resolveAssociatedActionTarget(child)
      if (selected && needsAuthContext(selected.action, seen)) {
        return true
      }
    }
    const target = AST.isValueReference(child) || AST.isMemberAccessExpression(child)
      ? child.target.ref
      : AST.isFunctionCallExpression(child)
      ? child.function.ref
      : undefined
    if (target && needsAuthContext(target, seen)) {
      return true
    }
  }
  return false
}

function hasAuthContextFactory(node: AST.Node): boolean {
  const moduleBinding = AST.isTaoFile(node.$container)
    || (AST.isActionDeclaration(node) && AST.isAppBlock(node.$container))
  return moduleBinding && authLibraryExport(node) !== 'Account' && needsAuthContext(node)
}

/** Context factories use normal Tao functions, with an explicit hidden argument at each read. */
export function withAuthContextFactory(
  node: AST.AliasDeclaration | AST.ActionDeclaration | AST.FunctionDeclaration | AST.PhraseDeclaration,
  code: Compiled,
): Compiled {
  if (!hasAuthContextFactory(node)) {
    return code
  }
  return gen`${gen.scopeName(node)} = TR.Function((_TaoAuthArgument: TR.Evaluable) => {
    const _TaoAuthScope = _TaoAuthArgument.evaluate().jsValue as TR.AuthScope | undefined
    void _TaoAuthScope
    return TR.BlockScope(_Scope, _Scope => {
      ${code}
      return ${gen.scopeName(node)}
    })
  })`
}

export function contextualReference(
  node: AST.AliasDeclaration | AST.ActionDeclaration | AST.FunctionDeclaration | AST.PhraseDeclaration,
): Compiled {
  if (!hasAuthContextFactory(node)) {
    return gen.scopeName(node)
  }
  const value = gen`TR.Call(${gen.scopeName(node)}, TR.Value(_TaoAuthScope))`
  return AST.isFunctionDeclaration(node) || AST.isPhraseDeclaration(node)
    ? gen`(${value} as unknown as TR.Function)`
    : value
}

/** The current Account is a row in the app's declared account store, never a library-global row. */
export function compileCurrentAccount(): Compiled {
  const plan = activeDataStorePlan()
  const store = plan?.stores.find(store => store.collections.some(entity => entity.singularName === 'Account'))
  Assert.defined(store, 'an auth Account read has an application Account entity')
  return gen`TR.Auth.Account(_TaoAuthScope!, ${gen.scopeName({ name: store.binding })}, 'Account')`
}

/** App roots bind account metadata to their own scope; shared library modules import no app catalog. */
export function compileAccountBinding(): Compiled {
  const store = activeDataStorePlan()?.stores.find(store =>
    store.collections.some(entity => entity.singularName === 'Account')
  )
  return store
    ? gen`TR.Auth.BindAccount(_TaoAuthScope, ${gen.scopeName({ name: store.binding })}, 'Account')`
    : gen.noop()
}

/** Commands carry the mounted scope as a private fill, preserving their public declaration identity. */
export function contextualCommand(command: AST.CommandDeclaration): Compiled {
  return needsAuthContext(command)
    ? gen`TR.Interaction.Bind(${gen.scopeName(command)}, { __taoAuth: TR.Value(_TaoAuthScope) })`
    : gen.scopeName(command)
}

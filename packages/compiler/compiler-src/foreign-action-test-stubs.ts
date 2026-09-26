import { AST } from '@parser'
import { Platform } from '@shared'

/** A declaration's digest is stable across compilation passes without embedding a checkout path in the app. */
export function foreignActionTestStubKey(action: AST.ActionDeclaration): string {
  return Platform.sha256Hex(`${AST.getDocument(action).uri.path}:${action.$cstNode?.offset ?? 0}:${action.name}`)
}

import { AST } from '@parser'
import type { FormatHandlers, NodeFormat } from '../formatting'

export const ConfigurationFormatter = {
  /** NavDeclaration formats one declaration-owned navigation configuration contract. */
  NavDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('nav')
    f.oneSpaceAround('=')
    f.oneSpaceBeforeProperty('block')
  },

  /** DatasourceDeclaration formats one declaration-owned provider configuration contract. */
  DatasourceDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('datasource')
    f.oneSpaceAround('=')
    f.oneSpaceBeforeProperty('block')
  },

  /** ConfigurationDeclarationBlock separates the public contract from its injected implementation. */
  ConfigurationDeclarationBlock(f) {
    f.indentedBraceBlock(f.node.entries)
    f.separateIndentedLines(
      f.node.entries,
      (_previous, next) => AST.isConfigurationImplementation(next) ? 2 : 1,
    )
  },

  /** ConfigurationPropertyDeclaration keeps a property name adjacent to its declared Tao type. */
  ConfigurationPropertyDeclaration(f) {
    f.oneSpaceBetweenProperties('name', 'type')
    f.oneSpaceAround('is')
  },

  /** ConfigurationKeyDeclaration formats the shared keyed-item property shape as a nested block. */
  ConfigurationKeyDeclaration(f) {
    f.oneSpaceBeforeProperty('block')
  },

  /** ConfigurationPropertyBlock puts every keyed-item property on its own indented line. */
  ConfigurationPropertyBlock(f) {
    f.indentedBraceBlock(f.node.properties)
    f.lineSeparatedList(f.node.properties)
  },

  /** ConfigurationImplementation formats `provider Name from ./Module.ts`. */
  ConfigurationImplementation(f) {
    f.oneSpaceAfter('nav', 'provider', 'from')
    f.oneSpaceBeforeProperty('path')
  },

  /** ConfigurationIssues formats `issues { IdentityToken, Session }` on one line. */
  ConfigurationIssues(f) {
    pairingBlock(f, 'issues', f.node.proofs)
  },

  /** ConfigurationIssuedProof is one proof kind with no interior spacing. */
  ConfigurationIssuedProof() {},

  /** ConfigurationAccepts formats `accepts { IdentityToken from Clerk, Session }` on one line. */
  ConfigurationAccepts(f) {
    pairingBlock(f, 'accepts', f.node.proofs)
  },

  /** ConfigurationAcceptedProof formats `Kind from AuthType`. */
  ConfigurationAcceptedProof(f) {
    f.oneSpaceAround('from')
  },

  /** ConfigurationSupports formats `supports { Relations, Migrations Additive }` on one line. */
  ConfigurationSupports(f) {
    pairingBlock(f, 'supports', f.node.capabilities)
  },

  /** ConfigurationCapability keeps a capability adjacent to its level. */
  ConfigurationCapability(f) {
    f.oneSpaceBetweenProperties('capability', 'level')
  },
} satisfies Partial<FormatHandlers>

/** pairingBlock keeps a pairing list on one line, and an empty one as `{ }`. */
function pairingBlock(
  f: NodeFormat<AST.ConfigurationIssues | AST.ConfigurationAccepts | AST.ConfigurationSupports>,
  keyword: string,
  items: readonly AST.Node[],
): void {
  f.oneSpaceAfter(keyword)
  if (items.length === 0) {
    f.oneSpaceAfter('{')
    return
  }
  f.singleLineBraceBlock()
  f.commaSpacedList()
}

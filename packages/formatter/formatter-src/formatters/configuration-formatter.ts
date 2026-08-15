import { AST } from '@parser'
import type { FormatHandlers } from '../formatting'

export default {
  /** NavDeclaration formats one declaration-owned navigation configuration contract. */
  NavDeclaration(f) {
    f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'nav')
    f.oneSpaceBeforeProperty('block')
  },

  /** DatasourceDeclaration formats one declaration-owned provider configuration contract. */
  DatasourceDeclaration(f) {
    f.oneSpaceAfter('file', 'package', 'workspace', 'public', 'datasource')
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

  /** ConfigurationImplementation formats inline and sidecar package-scope protocol bindings. */
  ConfigurationImplementation(f) {
    f.oneSpaceAfter('implement', 'inject', 'nav', 'provider')
    f.oneSpaceBeforeProperty('tsCodeBlock', 'sidecarPath')
  },
} satisfies Partial<FormatHandlers>

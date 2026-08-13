import { AST } from '@parser'
import { Assert, Text } from '@shared'
import { type Compiled, gen } from '../codegen-util'

export const ConfigurationCompiler = {
  /** ConfigurableDeclaration emits one declaration-identity binding and evaluates its injection once. */
  ConfigurableDeclaration(declaration: AST.ConfigurableDeclaration): Compiled {
    const implementation = AST.configurationImplementationOf(declaration)
    Assert.defined(implementation, 'validated configurable declaration has one implementation')
    const code = stripTsFence(implementation.tsCodeBlock)
    const factory = gen`Reflect.apply(
      function __tao_configuration_implementation__() {
        ${gen.textLines(code)}
      },
      undefined,
      [],
    )`
    return AST.isNavDeclaration(declaration)
      ? gen`${gen.scopeName(declaration)} = TR.Navigation.Declaration(
          ${gen.jsLiteral(declaration.name)},
          ${factory},
        )`
      : gen`${gen.scopeName(declaration)} = TR.Data.Declaration(
          ${gen.jsLiteral(declaration.name)},
          ${factory},
        )`
  },
} as const

function stripTsFence(code: string): string {
  return Text.stripIndent(code.replace(/^```ts[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```$/, ''))
}

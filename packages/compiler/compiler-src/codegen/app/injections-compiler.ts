import { AST } from '@parser'
import { Text } from '@shared'
import { type Compiled, gen, genTextLines } from '../codegen-util'

export default {
  /** CompileInjection generates a self-invoced block of the injected TS code. */
  CompileInjection(injection: AST.Injection): Compiled {
    const code = stripTsFence(injection.tsCodeBlock)
    return gen`
      (function __injection__() {
        ${genTextLines(code)}
      })()
    `
  },
} as const

function stripTsFence(code: string): string {
  return Text.stripIndent(code.replace(/^```ts[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```$/, ''))
}

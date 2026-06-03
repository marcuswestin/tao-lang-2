import { Parser, type ParseResult } from '@tao/parser'
import { compileFile as compileRuntimeFile } from './codegen/app/runtime-gen'

/** Compiler exposes Tao source compilation functions. */
export namespace Compiler {
  /** CompileResult declares the generated Expo-compatible TSX source. */
  export type CompileResult = {
    code: string
  }

  /** compileFile compiles the Tao file at `path` into Expo-compatible TSX source. */
  export async function compileFile(path: string): Promise<CompileResult> {
    return compileParsed(await Parser.parseFile(path))
  }

  /** compileCode compiles Tao source code into Expo-compatible TSX source. */
  export async function compileCode(code: string): Promise<CompileResult> {
    return compileParsed(await Parser.parseCode(code))
  }

  function compileParsed(parsed: ParseResult): CompileResult {
    assertParseClean(parsed)
    return { code: compileRuntimeFile(parsed.ast) }
  }

  function assertParseClean(parsed: ParseResult): void {
    const errors = [
      ...parsed.document.parseResult.lexerErrors.map(error => error.message),
      ...parsed.document.parseResult.parserErrors.map(error => error.message),
      ...parsed.diagnostics.map(diagnostic => diagnostic.message),
    ]
    if (errors.length > 0) {
      throw new Error(`Cannot compile Tao source with parser errors:\n${errors.join('\n')}`)
    }
  }
}

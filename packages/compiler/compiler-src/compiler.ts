import { AST, Parser, type ParseResult } from '@parser'
import { Assert } from '@shared'
import { compileFile as compileRuntimeFile } from './codegen/app/runtime-gen'

type CompileResult = {
  code: string
}

/** compileFile compiles the Tao file at `path` into Expo-compatible TSX source. */
async function compileFile(path: string): Promise<CompileResult> {
  return compileParsed(await Parser.parseFile(path))
}

/** compileCode compiles Tao source code into Expo-compatible TSX source. */
async function compileCode(code: string): Promise<CompileResult> {
  return compileParsed(await Parser.parseCode(code))
}

/** Compiler exposes Tao source compilation functions. */
const Compiler = {
  compileCode,
  compileFile,
}
export default Compiler

function compileParsed(parsed: ParseResult): CompileResult {
  assertParseClean(parsed)
  return { code: compileRuntimeFile(parsed.ast) }
}

function assertParseClean(parsed: ParseResult): void {
  const parseErrors = [
    ...parsed.document.parseResult.lexerErrors.map(error => error.message),
    ...parsed.document.parseResult.parserErrors.map(error => error.message),
  ]
  const parseErrorSet = new Set(parseErrors)
  const diagnostics = parsed.diagnostics
    .filter(isErrorDiagnostic)
    .map(diagnostic => diagnostic.message)
    .filter(message => !parseErrorSet.has(message))
  const errors = [
    ...parseErrors,
    ...diagnostics,
  ]
  Assert(errors.length === 0, `Cannot compile Tao source with parser errors`, { errors })
}

const diagnosticErrorSeverity = 1

function isErrorDiagnostic(diagnostic: AST.ParseDiagnostic): boolean {
  return diagnostic.severity === undefined || diagnostic.severity === diagnosticErrorSeverity
}

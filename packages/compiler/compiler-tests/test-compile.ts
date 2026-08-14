import Compiler, { type CompileOptions, type CompileResult } from '../compiler-src/compiler'

const compilerSession = Compiler.createSession()

/** testCompileCode compiles source through one serialized package and validator context for this test process. */
async function testCompileCode(code: string, options?: CompileOptions): Promise<CompileResult> {
  return await (await compilerSession).compileCode(code, options)
}

/** TestCompiler exposes the compiler API with session-backed source compilation for tests. */
export const TestCompiler = {
  ...Compiler,
  compileCode: testCompileCode,
} as const

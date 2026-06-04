import {
  testParseCode,
} from '../../parser/parser-tests/test-parse'
import Compiler from '../compiler-src/compiler'

type CompileResult = Awaited<ReturnType<typeof Compiler.compileCode>>

/** testCompileCode compiles Tao source after asserting that it parses without errors. */
export async function testCompileCode(source: string): Promise<CompileResult> {
  await testParseCode(source)
  return Compiler.compileCode(source)
}

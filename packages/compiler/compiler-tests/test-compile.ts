import { Packages } from '@ast-utils'
import { Workspace } from '@compiler/workspace'
import { Assert, FS } from '@shared'
import { withTaoFiles } from '@shared/test'
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

/**
 * withCompiledTestPlan writes the given files, validates the `.test.tao` entry, and hands its compiled
 * test plan to `run`, so a plan-shape test states only the sources and the expectations.
 */
export async function withCompiledTestPlan<const Files extends Record<string, string>>(
  prefix: string,
  files: Files,
  run: (plan: Compiler.TestPlan, paths: { [Path in keyof Files]: string }) => Promise<void> | void,
): Promise<void> {
  await withTaoFiles(prefix, files, async paths => {
    const testPath = Object.values(paths).find(path => path.endsWith('.test.tao'))
    Assert.defined(testPath, 'a compiled test plan needs one .test.tao file', { paths })
    const validation = await Workspace.validate(testPath)
    const plan = Compiler.compileTestPlan(
      validation,
      Compiler.createContext(await Packages.createContext(FS.dirname(testPath)), FS.dirname(testPath)),
    )
    await run(plan, paths)
  }, { location: 'host' })
}

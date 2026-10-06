import { FS, TaoResources } from '@shared'
import type * as ts from 'typescript'

/**
 * An installed CLI bundles the TypeScript compiler into its binary, and the bundle keeps the
 * compiler's own `__filename` from the machine that built it, so its default library location names
 * a checkout that does not exist on the user's machine. Installed resources carry the pinned
 * TypeScript package beside the native binding engine; its `lib` directory supplies the default
 * library declarations instead. Inside a checkout no resource root is declared and the compiler's
 * own location stands.
 */
export function installedTypeScriptLibraryDirectory(): string | undefined {
  const root = TaoResources.declaredRoot()
  if (root === undefined) {
    return undefined
  }
  const directory = FS.resolvePath(`${TaoResources.NATIVE_BINDINGS_ENGINE_DIRECTORY}/node_modules/typescript/lib`, root)
  return FS.existsSync(FS.resolvePath('lib.d.ts', directory)) ? directory : undefined
}

/** Point a compiler host at the installed default library declarations when they exist. */
export function useInstalledTypeScriptLibrary(engine: typeof ts, host: ts.CompilerHost): void {
  const directory = installedTypeScriptLibraryDirectory()
  if (directory === undefined) {
    return
  }
  host.getDefaultLibLocation = () => directory
  host.getDefaultLibFileName = options => FS.resolvePath(engine.getDefaultLibFileName(options), directory)
}

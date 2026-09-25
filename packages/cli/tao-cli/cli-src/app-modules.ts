import { Errors, FS, Platform, TaoResources } from '@shared'
import { inPlace } from './in-place-files'

/**
 * CLI_PACKAGE_ROOT is the tree that carries this CLI's `modules/@tao/*`. An installed binary's
 * resource root is laid out as one, because inside the binary `import.meta.dir` names `/$bunfs`,
 * which no project's TypeScript or Metro can resolve through a link.
 */
const CLI_PACKAGE_ROOT = TaoResources.declaredRoot() ?? FS.resolvePath('..', import.meta.dir)

/**
 * PROJECT_TSCONFIG is the TypeScript project `tao create` writes. Sidecar files resolve `@tao/*`
 * through a `node_modules/@tao` link that `ensureProject` points at the runtime this CLI ships.
 */
export const PROJECT_TSCONFIG = `{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "jsx": "react-jsx",
    "lib": [
      "DOM",
      "ES2023"
    ],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "noEmit": true,
    "paths": {
      "@tao/*": [
        "./node_modules/@tao/*"
      ],
      "@tao/runtime": [
        "./node_modules/@tao/runtime/TaoRuntime-src/TR.ts"
      ]
    },
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022"
  },
  "include": [
    "**/*.ts",
    "**/*.tsx"
  ]
}
`

/**
 * TaoAppModules locates the `@tao/*` TypeScript packages the CLI hands to a project and links them in.
 *
 * In-repo runs resolve the workspace's `packages/apps/runtime`; distributable CLI assembly calls
 * `packageRuntime` to carry the same package as a real directory under `modules/@tao/runtime`.
 */
export const TaoAppModules = {
  /** root is the directory a packaged CLI carries its own `@tao/*` modules in. */
  root: FS.resolvePath('modules/@tao', CLI_PACKAGE_ROOT),

  /**
   * runtimeRoot is the runtime package this CLI ships. `cliPackageRoot` exists so the relocated case --
   * a CLI tree with no `../../apps/runtime` beside it -- is reachable from a test rather than only in the field.
   */
  runtimeRoot(cliPackageRoot: string = CLI_PACKAGE_ROOT): string {
    const sibling = FS.resolvePath('../../apps/runtime', cliPackageRoot)
    if (FS.existsSync(FS.resolvePath('TaoRuntime-src/TR.ts', sibling))) {
      return sibling
    }
    const bundled = FS.resolvePath(TaoResources.RUNTIME_DIRECTORY, cliPackageRoot)
    if (FS.existsSync(FS.resolvePath('TaoRuntime-src/TR.ts', bundled))) {
      return bundled
    }
    return Errors.throwHostEnvironment(
      `The Tao CLI has no @tao/runtime module: neither ${sibling} nor ${bundled} holds TaoRuntime-src/TR.ts.`,
    )
  },

  /**
   * packageRuntime copies the real runtime package into a relocatable CLI artifact. A future
   * packager's complete assembly call is:
   * `await TaoAppModules.packageRuntime(cliArtifactRoot, runtimePackageRoot)`.
   */
  async packageRuntime(cliPackageRoot: string, runtimePackageRoot: string): Promise<string> {
    const source = FS.resolvePath(runtimePackageRoot)
    if (!await FS.isFile(FS.resolvePath('TaoRuntime-src/TR.ts', source))) {
      return Errors.throwHostEnvironment(`Cannot package @tao/runtime: ${source} has no TaoRuntime-src/TR.ts.`)
    }
    const destination = FS.resolvePath(TaoResources.RUNTIME_DIRECTORY, cliPackageRoot)
    const temporary = `${destination}.tmp-${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
    try {
      await FS.copyDirectory(FS.resolvePath('TaoRuntime-src', source), FS.resolvePath('TaoRuntime-src', temporary))
      const packageJson = FS.resolvePath('package.json', source)
      if (await FS.isFile(packageJson)) {
        await FS.copyFile(packageJson, FS.resolvePath('package.json', temporary))
      }
      await FS.remove(destination)
      await FS.move(temporary, destination)
    } finally {
      await FS.remove(temporary).catch(() => undefined)
    }
    return destination
  },

  /** ensureProject points `node_modules/@tao/runtime` at the CLI-bundled runtime. */
  async ensureProject(projectRoot: string, cliPackageRoot: string = CLI_PACKAGE_ROOT): Promise<void> {
    if (!await FS.isFile(FS.resolvePath('tsconfig.json', projectRoot))) {
      return
    }
    const target = await FS.realPath(TaoAppModules.runtimeRoot(cliPackageRoot))
    const linkPath = FS.resolvePath('node_modules/@tao/runtime', projectRoot)
    await FS.replaceSymlink(target, linkPath)
  },

  /** ensureForPath links `@tao/runtime` into the Tao project that owns `path`. */
  async ensureForPath(path: string): Promise<void> {
    await TaoAppModules.ensureProject(await inPlace.workspaceRootForPath(path))
  },
} as const

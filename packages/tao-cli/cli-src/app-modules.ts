import { Errors, FS } from '@shared'
import { inPlace } from './in-place-files'

const CLI_PACKAGE_ROOT = FS.resolvePath('..', import.meta.dir)

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
 * Today the only source that actually exists is the workspace's own `packages/runtime`, which is what
 * every in-repo run resolves. `modules/@tao/` is the place a packaged CLI would carry its own copy, and
 * it is empty: nothing copies into it yet, so a CLI relocated out of this repository fails with the
 * message below rather than silently linking a project at nothing. See
 * `Docs/Roadmap/Developer environment upgrades.md` for the packaging step that has to fill it.
 */
export const TaoAppModules = {
  /** root is the directory a packaged CLI carries its own `@tao/*` modules in. */
  root: FS.resolvePath('modules/@tao', CLI_PACKAGE_ROOT),

  /**
   * runtimeRoot is the runtime package this CLI ships. `cliPackageRoot` exists so the relocated case --
   * a CLI tree with no `../runtime` beside it -- is reachable from a test rather than only in the field.
   */
  runtimeRoot(cliPackageRoot: string = CLI_PACKAGE_ROOT): string {
    const sibling = FS.resolvePath('../runtime', cliPackageRoot)
    if (FS.existsSync(FS.resolvePath('TaoRuntime-src/TR.ts', sibling))) {
      return sibling
    }
    const bundled = FS.resolvePath('modules/@tao/runtime', cliPackageRoot)
    if (FS.existsSync(FS.resolvePath('TaoRuntime-src/TR.ts', bundled))) {
      return bundled
    }
    return Errors.throwHostEnvironment(
      `The Tao CLI has no @tao/runtime module: neither ${sibling} nor ${bundled} holds TaoRuntime-src/TR.ts.`,
    )
  },

  /** ensureProject points `node_modules/@tao/runtime` at the CLI-bundled runtime. */
  async ensureProject(projectRoot: string): Promise<void> {
    if (!await FS.isFile(FS.resolvePath('tsconfig.json', projectRoot))) {
      return
    }
    const target = await FS.realPath(TaoAppModules.runtimeRoot())
    const linkPath = FS.resolvePath('node_modules/@tao/runtime', projectRoot)
    await FS.replaceSymlink(target, linkPath)
  },

  /** ensureForPath links `@tao/runtime` into the Tao project that owns `path`. */
  async ensureForPath(path: string): Promise<void> {
    await TaoAppModules.ensureProject(await inPlace.workspaceRootForPath(path))
  },
} as const

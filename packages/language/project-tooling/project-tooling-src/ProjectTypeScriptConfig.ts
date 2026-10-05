import { Packages } from '@ast-utils'
import { type Diagnostic, FS, HCI, Platform, ProjectLocal } from '@shared'
import * as ts from 'typescript'
import {
  ambientTypeNames,
  hostModulePaths,
  hostTypeRoots,
  type ProjectHostModuleSession,
  projectTypeRoots,
  resolveRuntimeRoot,
} from './ProjectHostModules'
import { nestedProjectRoots } from './ProjectSourceOwnership'
import type { ProjectToolingOptions } from './ProjectTooling'

const ROOT_CONFIG = 'tsconfig.json'
const BASE_CONFIG = '.tao/cache/typescript/tsconfig.json'

/** Config diagnostics used by the project tooling validator. */
export const ProjectConfigValidationMessages = {
  missingProjectMarker: (root: string) => `No Tao project marker (.tao directory) was found for ${root}.`,
  incompatibleRootDir: (rootDir: string) =>
    `TypeScript rootDir ${rootDir} excludes generated Tao contracts in .tao-ts; include the project root in rootDir.`,
  incompatibleRootDirs: () =>
    'TypeScript rootDirs must include both the project root and .tao-ts for Tao contract imports.',
  incompatibleOutput: (option: string) =>
    `TypeScript ${option} conflicts with Tao's no-emit contract checking; remove or change that option.`,
  incompatibleOption: (option: string, expected: string) =>
    `TypeScript ${option} must be ${expected} for Tao implementation checks; update the authored tsconfig override.`,
  missingGeneratedContracts: (paths: readonly string[]) =>
    `TypeScript include/exclude omits generated Tao contracts: ${paths.join(', ')}.`,
  nestedProjectInputs: (paths: readonly string[]) =>
    `TypeScript include/exclude includes sources owned by a nested Tao project: ${paths.join(', ')}.`,
} as const

export type ProjectTypeScriptConfigResult = {
  rootConfigPath: string
  baseConfigPath: string
  changedOutputPaths: readonly string[]
  diagnostics: readonly Diagnostic[]
}

/** Find the nearest marked Tao project, independent of any tsconfig in an ancestor. */
export async function findProjectRoot(inputPath: string): Promise<string | undefined> {
  const path = FS.resolvePath(inputPath)
  const directory = await FS.isDirectory(path) ? path : FS.dirname(path)
  return await Packages.containingProjectRoot(directory)
}

/** Publish the default root config only when absent, preserving all authored config bytes. */
export async function ensureProjectTypeScriptConfig(
  root: string,
  options: ProjectToolingOptions = {},
): Promise<ProjectTypeScriptConfigResult> {
  const projectRoot = FS.resolvePath(root)
  if (!await FS.isDirectory(FS.resolvePath('.tao', projectRoot))) {
    return await writeProjectTypeScriptConfigUnderLock(projectRoot, options)
  }
  await ProjectLocal.prepare(projectRoot)
  return await FS.withFileMutationLock(
    FS.resolvePath('.tao/cache/locks/ts-gen-lock', projectRoot),
    projectRoot,
    async () => await writeProjectTypeScriptConfigUnderLock(projectRoot, options),
  )
}

/** The service calls this inside its project-wide mutation lock. */
export async function writeProjectTypeScriptConfigUnderLock(
  root: string,
  options: ProjectToolingOptions = {},
  excludedHostPackages: ReadonlySet<string> = new Set(),
  hostModuleSession?: ProjectHostModuleSession,
): Promise<ProjectTypeScriptConfigResult> {
  const projectRoot = FS.resolvePath(root)
  const rootConfigPath = FS.resolvePath(ROOT_CONFIG, projectRoot)
  const baseConfigPath = FS.resolvePath(BASE_CONFIG, projectRoot)
  if (!await FS.isDirectory(FS.resolvePath('.tao', projectRoot))) {
    return {
      rootConfigPath,
      baseConfigPath,
      changedOutputPaths: [],
      diagnostics: [{
        filePath: projectRoot,
        message: ProjectConfigValidationMessages.missingProjectMarker(projectRoot),
        severity: 'error',
        source: 'compiler',
      }],
    }
  }

  const baseContent = `${
    JSON.stringify(await baseConfig(projectRoot, options, excludedHostPackages, hostModuleSession), null, 2)
  }\n`
  const changedOutputPaths: string[] = []
  if (!await FS.isFile(baseConfigPath) || await FS.readText(baseConfigPath) !== baseContent) {
    await FS.writeText(baseConfigPath, baseContent)
    changedOutputPaths.push(baseConfigPath)
  }
  if (!await FS.exists(rootConfigPath)) {
    await FS.writeText(rootConfigPath, '{ "extends": "./.tao/cache/typescript/tsconfig.json" }\n')
    changedOutputPaths.push(rootConfigPath)
  }
  return { rootConfigPath, baseConfigPath, changedOutputPaths, diagnostics: [] }
}

async function baseConfig(
  projectRoot: string,
  options: ProjectToolingOptions,
  excludedHostPackages: ReadonlySet<string>,
  hostModuleSession?: ProjectHostModuleSession,
): Promise<object> {
  const profileEnabled = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] === 'true'
  const phaseTimes: Record<string, number> = {}
  let phaseStartedAt = profileEnabled ? performance.now() : 0
  const runtimePath = FS.resolvePath('TaoRuntime-src/TR.ts', resolveRuntimeRoot(projectRoot, options))
  const authoredTypeRoots = projectTypeRoots(projectRoot)
  const typeRoots = [...new Set([...authoredTypeRoots, ...hostTypeRoots(options)])]
  const projectTypes = ts.getAutomaticTypeDirectiveNames({ typeRoots: authoredTypeRoots }, ts.sys)
  if (profileEnabled) {
    phaseTimes['automatic-type-discovery'] = performance.now() - phaseStartedAt
    phaseStartedAt = performance.now()
  }
  const nestedRoots = await nestedProjectRoots(projectRoot)
  if (profileEnabled) {
    phaseTimes['nested-project-discovery'] = performance.now() - phaseStartedAt
    phaseStartedAt = performance.now()
  }
  const hostModules = await hostModulePaths(projectRoot, options, excludedHostPackages, hostModuleSession)
  if (profileEnabled) {
    phaseTimes['host-module-discovery'] = performance.now() - phaseStartedAt
    HCI.logProcessInfo(
      'project-tooling',
      JSON.stringify({ type: 'studio-typescript-config-profile', root: projectRoot, phases: phaseTimes }),
    )
  }
  return {
    compilerOptions: {
      allowImportingTsExtensions: true,
      allowJs: true,
      checkJs: true,
      jsx: 'react-jsx',
      lib: ['DOM', 'DOM.Iterable', 'ES2023'],
      module: 'ESNext',
      moduleResolution: 'bundler',
      noEmit: true,
      resolveJsonModule: true,
      rootDirs: ['../../..', '../../../.tao-ts'],
      paths: {
        ...hostModules,
        '@tao/runtime': [runtimePath],
      },
      skipLibCheck: true,
      strict: true,
      target: 'ES2022',
      typeRoots,
      types: [...new Set([...projectTypes, ...ambientTypeNames(typeRoots)])],
    },
    include: [
      '../../../**/*.ts',
      '../../../**/*.tsx',
      '../../../**/*.mts',
      '../../../**/*.cts',
      '../../../**/*.js',
      '../../../**/*.jsx',
      '../../../**/*.mjs',
      '../../../**/*.cjs',
      '../../../.tao-ts/**/*.ts',
      '../../../.tao-ts/**/*.tsx',
      '../../../.tao-ts/**/*.mts',
      '../../../.tao-ts/**/*.cts',
      '../../../.tao-ts/**/*.js',
      '../../../.tao-ts/**/*.jsx',
      '../../../.tao-ts/**/*.mjs',
      '../../../.tao-ts/**/*.cjs',
      '../../../.tao-ts/.dependencies/**/*.ts',
      '../../../.tao-ts/.dependencies/**/*.tsx',
      '../../../.tao-ts/.dependencies/**/*.mts',
      '../../../.tao-ts/.dependencies/**/*.cts',
      '../../../.tao-ts/.dependencies/**/*.js',
      '../../../.tao-ts/.dependencies/**/*.jsx',
      '../../../.tao-ts/.dependencies/**/*.mjs',
      '../../../.tao-ts/.dependencies/**/*.cjs',
    ],
    exclude: [
      '../../../node_modules',
      '../../../.tao',
      '../../../.git',
      '../../../.artifacts',
      ...nestedRoots.map(root => FS.relativePath(FS.resolvePath('.tao/cache/typescript', projectRoot), root)),
    ],
  }
}

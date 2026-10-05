import { type Diagnostic, type DiagnosticRange, FS } from '@shared'
import * as ts from 'typescript'
import { belongsToProject, nestedProjectRoots } from './ProjectSourceOwnership'
import type { ProjectToolingOptions, ProjectToolingSourceMapping } from './ProjectTooling'
import { ProjectConfigValidationMessages } from './ProjectTypeScriptConfig'
import { ProjectTypeScriptProgramSession } from './ProjectTypeScriptProgram'

export { ProjectTypeScriptProgramSession } from './ProjectTypeScriptProgram'

/** Check authored TypeScript and published contracts as one no-emit program. */
export async function checkProjectTypeScript(
  root: string,
  contractPaths: readonly string[],
  snapshotPaths: readonly string[],
  sourceMappings: readonly ProjectToolingSourceMapping[],
  _options: ProjectToolingOptions,
): Promise<Diagnostic[]> {
  return (await checkProjectTypeScriptWithConfigInputs(root, contractPaths, snapshotPaths, sourceMappings, _options))
    .diagnostics
}

export type ProjectTypeScriptCheckResult = {
  diagnostics: Diagnostic[]
  /** Native config probes, including missing extends targets needed for recovery. */
  configInputPaths: readonly string[]
  cacheHit?: boolean
  programAuditMs?: number
}

export async function checkProjectTypeScriptWithConfigInputs(
  root: string,
  contractPaths: readonly string[],
  snapshotPaths: readonly string[],
  sourceMappings: readonly ProjectToolingSourceMapping[],
  _options: ProjectToolingOptions,
  session?: ProjectTypeScriptProgramSession,
): Promise<ProjectTypeScriptCheckResult> {
  const projectRoot = FS.resolvePath(root)
  const configPath = FS.resolvePath('tsconfig.json', projectRoot)
  const configurationSources = new Map<string, string | undefined>()
  const readConfiguration = (path: string): string | undefined => {
    const text = ts.sys.readFile(path)
    configurationSources.set(FS.resolvePath(path), text)
    return text
  }
  const read = ts.readConfigFile(configPath, readConfiguration)
  if (read.error !== undefined) {
    session?.clear()
    return { diagnostics: [typescriptDiagnostic(read.error, sourceMappings)], configInputPaths: [] }
  }
  const configInputs = new Set<string>()
  const configHost: ts.ParseConfigHost = {
    ...ts.sys,
    fileExists(path) {
      configInputs.add(FS.resolvePath(path))
      return ts.sys.fileExists(path)
    },
    readFile(path) {
      configInputs.add(FS.resolvePath(path))
      return readConfiguration(path)
    },
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, configHost, projectRoot, undefined, configPath)
  const configInputPaths = [...configInputs].filter(path => path !== configPath).sort()
  // The generated overlay can be a valid Tao-only project with no authored TypeScript inputs.
  // Contract and dependency files are supplied explicitly to createProgram below.
  const diagnostics: Diagnostic[] = parsed.errors.filter(error => error.code !== 18003)
    .map(error => typescriptDiagnostic(error, sourceMappings))
  const generatedRoot = FS.resolvePath('.tao-ts', projectRoot)
  const configuredRootDir = parsed.options.rootDir
  if (configuredRootDir !== undefined && !FS.pathIsWithin(generatedRoot, configuredRootDir)) {
    diagnostics.push(
      configDiagnostic(configPath, ProjectConfigValidationMessages.incompatibleRootDir(configuredRootDir)),
    )
  }
  const configuredRootDirs = parsed.options.rootDirs
  if (
    contractPaths.length > 0
    && (configuredRootDirs === undefined
      || ![projectRoot, generatedRoot].every(rootDir =>
        configuredRootDirs.some(configured => FS.resolvePath(configured) === rootDir)
      ))
  ) {
    diagnostics.push(configDiagnostic(configPath, ProjectConfigValidationMessages.incompatibleRootDirs()))
  }
  if (parsed.options.outFile !== undefined) {
    diagnostics.push(configDiagnostic(configPath, ProjectConfigValidationMessages.incompatibleOutput('outFile')))
  }
  if (parsed.options.noEmit !== true) {
    diagnostics.push(configDiagnostic(configPath, ProjectConfigValidationMessages.incompatibleOutput('noEmit: false')))
  }
  const requiredOptions = [
    ['strict', parsed.options.strict, true, 'true'],
    ['allowImportingTsExtensions', parsed.options.allowImportingTsExtensions, true, 'true'],
    ['allowJs', parsed.options.allowJs, true, 'true'],
    ['checkJs', parsed.options.checkJs, true, 'true'],
    ['resolveJsonModule', parsed.options.resolveJsonModule, true, 'true'],
    ['jsx', parsed.options.jsx, ts.JsxEmit.ReactJSX, 'react-jsx'],
    ['module', parsed.options.module, ts.ModuleKind.ESNext, 'ESNext'],
    ['moduleResolution', parsed.options.moduleResolution, ts.ModuleResolutionKind.Bundler, 'bundler'],
  ] as const
  for (const [option, actual, expected, label] of requiredOptions) {
    if (actual !== expected) {
      diagnostics.push(configDiagnostic(configPath, ProjectConfigValidationMessages.incompatibleOption(option, label)))
    }
  }
  const nativeFiles = new Set(parsed.fileNames.map(path => FS.resolvePath(path)))
  const missingGenerated = contractPaths.filter(path => !nativeFiles.has(FS.resolvePath(path)))
  if (missingGenerated.length > 0) {
    diagnostics.push(configDiagnostic(
      configPath,
      ProjectConfigValidationMessages.missingGeneratedContracts(missingGenerated),
    ))
  }
  const nestedRoots = await nestedProjectRoots(projectRoot)
  const nestedInputs = parsed.fileNames.filter(path =>
    FS.pathIsWithin(path, projectRoot) && !belongsToProject(path, projectRoot, nestedRoots)
  )
  if (nestedInputs.length > 0) {
    diagnostics.push(configDiagnostic(
      configPath,
      ProjectConfigValidationMessages.nestedProjectInputs(nestedInputs),
    ))
  }
  if (diagnostics.some(diagnostic => diagnostic.severity === 'error')) {
    session?.clear()
    return { diagnostics, configInputPaths }
  }

  const files = new Set([
    ...parsed.fileNames.filter(path =>
      !FS.pathIsWithin(path, projectRoot) || belongsToProject(path, projectRoot, nestedRoots)
    ),
    ...contractPaths,
    ...snapshotPaths,
  ])
  const { program, cacheHit, programAuditMs } =
    session?.program(projectRoot, [...files], parsed.options, [...configurationSources])
      ?? { program: ts.createProgram([...files], parsed.options), cacheHit: false, programAuditMs: 0 }
  diagnostics.push(...ts.getPreEmitDiagnostics(program).map(error => typescriptDiagnostic(error, sourceMappings)))
  return { diagnostics, configInputPaths, cacheHit, programAuditMs }
}

function configDiagnostic(filePath: string, message: string): Diagnostic {
  return { filePath, message, severity: 'error', source: 'compiler' }
}

function typescriptDiagnostic(error: ts.Diagnostic, mappings: readonly ProjectToolingSourceMapping[]): Diagnostic {
  const message = `TypeScript: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`
  if (error.file === undefined || error.start === undefined) {
    return { message, severity: 'error', source: 'compiler', code: `TS${error.code}` }
  }
  const filePath = FS.resolvePath(error.file.fileName)
  const start = error.file.getLineAndCharacterOfPosition(error.start)
  const end = error.file.getLineAndCharacterOfPosition(error.start + (error.length ?? 0))
  const range: DiagnosticRange = {
    start: { line: start.line, character: start.character },
    end: { line: end.line, character: end.character },
  }
  const mapping = mappings.find(candidate =>
    candidate.generatedPath === filePath
    && rangeContains(candidate.generatedRange, range.start)
  )
  return {
    filePath: mapping?.sourcePath ?? filePath,
    message,
    severity: 'error',
    source: 'compiler',
    code: `TS${error.code}`,
    range: mapping === undefined ? range : mappedRange(mapping, range),
  }
}

function rangeContains(range: DiagnosticRange, location: DiagnosticRange['start']): boolean {
  return (location.line > range.start.line
    || location.line === range.start.line && location.character >= range.start.character)
    && (location.line < range.end.line
      || location.line === range.end.line && location.character <= range.end.character)
}

function mappedRange(mapping: ProjectToolingSourceMapping, range: DiagnosticRange): DiagnosticRange {
  if (mapping.generatedRange.end.line === mapping.generatedRange.start.line) {
    return mapping.sourceRange
  }
  const offset = mapping.generatedRange.start.line - mapping.sourceRange.start.line
  return {
    start: { line: range.start.line - offset, character: range.start.character },
    end: { line: range.end.line - offset, character: range.end.character },
  }
}

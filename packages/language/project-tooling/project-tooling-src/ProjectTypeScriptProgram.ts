import { FS, HCI, Platform, Switch, Time } from '@shared'
import * as ts from 'typescript'
import { useInstalledTypeScriptLibrary } from './ProjectTypeScriptLibrary'

/** Declaration views are reader-local; their originating implementation bytes stay on disk. */
export type ProjectTypeScriptDeclarationViews = ReadonlyMap<string, string>

export function createProjectTypeScriptProgram(
  rootNames: readonly string[],
  options: ts.CompilerOptions,
  declarations: ProjectTypeScriptDeclarationViews = new Map(),
  engine: typeof ts = ts,
  sources: ReadonlyMap<string, string> = new Map(),
): ts.Program {
  const host = engine.createCompilerHost(options)
  useInstalledTypeScriptLibrary(engine, host)
  const getSourceFile = host.getSourceFile.bind(host)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  host.readFile = path => declarations.get(FS.resolvePath(path)) ?? sources.get(FS.resolvePath(path)) ?? readFile(path)
  host.fileExists = path =>
    declarations.has(FS.resolvePath(path)) || sources.has(FS.resolvePath(path)) || fileExists(path)
  const directories = new Set<string>()
  for (const path of sources.keys()) {
    for (let directory = FS.dirname(path);; directory = FS.dirname(directory)) {
      directories.add(directory)
      if (FS.dirname(directory) === directory) {
        break
      }
    }
  }
  const directoryExists = host.directoryExists?.bind(host)
  host.directoryExists = path => directories.has(FS.resolvePath(path)) || directoryExists?.(path) === true
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
    const declaration = declarations.get(FS.resolvePath(path))
    const source = sources.get(FS.resolvePath(path))
    if (declaration === undefined && source === undefined) {
      return getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
    }
    const file = engine.createSourceFile(path, declaration ?? source!, languageVersion)
    file.isDeclarationFile = declaration !== undefined
    return file
  }
  return engine.createProgram([...rootNames], options, host)
}

type Observation = {
  kind: 'readFile' | 'fileExists' | 'directoryExists' | 'readDirectory' | 'getDirectories' | 'realpath'
  args: readonly unknown[]
  value: string | boolean | readonly string[] | undefined
}

/** A single project's last program, guarded by the exact host filesystem view that built it. */
export class ProjectTypeScriptProgramSession {
  private last?: { key: string; program: ts.Program; observations: Map<string, Observation>; valid: boolean }

  clear(): void {
    this.last = undefined
  }

  program(
    root: string,
    rootNames: readonly string[],
    options: ts.CompilerOptions,
    configurationSources: readonly (readonly [string, string | undefined])[] = [],
  ): {
    program: ts.Program
    cacheHit: boolean
    programAuditMs: number
  } {
    const auditAt = Time.nowMs()
    const configFile = options['configFile']
    const configSource = typeof configFile === 'object' && configFile !== null
        && 'fileName' in configFile && typeof configFile['fileName'] === 'string'
        && 'text' in configFile && typeof configFile['text'] === 'string'
      ? [configFile['fileName'], configFile['text']]
      : undefined
    // The config parser has already selected the native roots and effective options anew.
    // Order matters for diagnostic order, so rootNames are not sorted.
    const key = JSON.stringify([
      FS.resolvePath(ts.sys.realpath?.(root) ?? root),
      rootNames.map(path => FS.resolvePath(path)),
      Object.entries(options).filter(([name]) => name !== 'configFile').sort(([a], [b]) => a.localeCompare(b)),
      configSource,
      configurationSources,
      ts.sys.getExecutingFilePath(),
      ts.sys.getCurrentDirectory(),
      ts.sys.useCaseSensitiveFileNames,
      ts.sys.newLine,
    ])
    const last = this.last
    const profile = Platform.runtimeProcess.env['TAO_STUDIO_PREVIEW_PROFILE'] === 'true'
    const rejection = last === undefined
      ? { reason: 'no-program' }
      : last.key !== key
      ? { reason: 'program-inputs-changed' }
      : !last.valid
      ? { reason: 'unstable-observations' }
      : observationsMismatch(last.observations)
    if (last !== undefined && rejection === undefined) {
      return { program: last.program, cacheHit: true, programAuditMs: Time.nowMs() - auditAt }
    }
    if (profile) {
      HCI.logProcessInfo(
        'project-tooling',
        JSON.stringify({ type: 'studio-native-program-profile', root, ...rejection }),
      )
    }

    const programAuditMs = Time.nowMs() - auditAt
    this.clear()
    const observations = new Map<string, Observation>()
    const entry = { key, program: undefined as unknown as ts.Program, observations, valid: true }
    const host = ts.createCompilerHost(options)
    useInstalledTypeScriptLibrary(ts, host)
    const watch = <T extends Observation['value']>(
      kind: Observation['kind'],
      args: readonly unknown[],
      run: () => T,
    ): T => {
      const value = run()
      const id = JSON.stringify([kind, args])
      const previous = observations.get(id)
      if (previous !== undefined && !sameValue(previous.value, value)) {
        entry.valid = false
      }
      observations.set(id, { kind, args, value })
      return value
    }
    const readFile = host.readFile.bind(host)
    host.readFile = path => watch('readFile', [path], () => readFile(path))
    const fileExists = host.fileExists.bind(host)
    host.fileExists = path => watch('fileExists', [path], () => fileExists(path))
    if (host.directoryExists !== undefined) {
      const directoryExists = host.directoryExists.bind(host)
      host.directoryExists = path => watch('directoryExists', [path], () => directoryExists(path))
    }
    if (host.readDirectory !== undefined) {
      const readDirectory = host.readDirectory.bind(host)
      host.readDirectory = (path, extensions, include, exclude, depth) =>
        watch(
          'readDirectory',
          [path, extensions, include, exclude, depth],
          () => readDirectory(path, extensions, include, exclude, depth),
        )
    }
    if (host.getDirectories !== undefined) {
      const getDirectories = host.getDirectories.bind(host)
      host.getDirectories = path => watch('getDirectories', [path], () => getDirectories(path))
    }
    if (host.realpath !== undefined) {
      const realpath = host.realpath.bind(host)
      host.realpath = path => watch('realpath', [path], () => realpath(path))
    }
    const program = ts.createProgram([...rootNames], options, host)
    entry.program = program
    this.last = entry
    return { program, cacheHit: false, programAuditMs }
  }
}

function observationsMismatch(
  observations: ReadonlyMap<string, Observation>,
): { reason: string; kind?: Observation['kind']; path?: string } | undefined {
  try {
    for (const observation of observations.values()) {
      const [path, extensions, include, exclude, depth] = observation.args as [
        string,
        readonly string[] | undefined,
        readonly string[] | undefined,
        readonly string[] | undefined,
        number | undefined,
      ]
      const current = Switch.on<Observation, 'kind', Observation['value']>(observation, 'kind', {
        readFile: () => ts.sys.readFile(path),
        fileExists: () => ts.sys.fileExists(path),
        directoryExists: () => ts.sys.directoryExists?.(path),
        readDirectory: () => ts.sys.readDirectory?.(path, extensions, include, exclude, depth),
        getDirectories: () => ts.sys.getDirectories?.(path),
        realpath: () => ts.sys.realpath?.(path),
      })
      if (!sameValue(observation.value, current)) {
        return { reason: 'observation-changed', kind: observation.kind, path }
      }
    }
    return undefined
  } catch {
    // Inaccessible or transient filesystem results cannot establish equivalence.
    return { reason: 'observation-unavailable' }
  }
}

function sameValue(a: Observation['value'], b: Observation['value']): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => value === b[index])
  }
  return a === b
}

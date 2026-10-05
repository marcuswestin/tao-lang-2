import { FS, Switch, Time } from '@shared'
import * as ts from 'typescript'

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
    if (last !== undefined && last.key === key && last.valid && observationsMatch(last.observations)) {
      return { program: last.program, cacheHit: true, programAuditMs: Time.nowMs() - auditAt }
    }

    const programAuditMs = Time.nowMs() - auditAt
    this.clear()
    const observations = new Map<string, Observation>()
    const entry = { key, program: undefined as unknown as ts.Program, observations, valid: true }
    const host = ts.createCompilerHost(options)
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

function observationsMatch(observations: ReadonlyMap<string, Observation>): boolean {
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
        return false
      }
    }
    return true
  } catch {
    // Inaccessible or transient filesystem results cannot establish equivalence.
    return false
  }
}

function sameValue(a: Observation['value'], b: Observation['value']): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length
      && a.every((value, index) => value === b[index])
  }
  return a === b
}

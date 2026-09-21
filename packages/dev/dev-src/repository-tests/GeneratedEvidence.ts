import { FS, Json, TaoStdlib } from '@shared'
import { compileAppOutputHash } from './CompileApp'
import { parserGenerateInputHash, parserGenerateOutputHash } from './ParserGenerate'

/** GeneratedOutput names ignored output whose bytes a Git-tree hash cannot describe. */
export type GeneratedOutput = 'compiled-app' | 'ide-extension' | 'parser'

export type GeneratedOutputEvidence = {
  /** Inputs outside the visible Git tree, or the generator's own precise input identity. */
  inputs: string
  /** The ignored output tree the successful generator left for its readers. */
  outputs: string
}

/** GeneratedEvidence is the versioned ignored-state half of a whole-lane green record. */
export type GeneratedEvidence = {
  outputs: Partial<Record<GeneratedOutput, GeneratedOutputEvidence>>
  version: 1
}

export type GeneratedEvidenceCapture = (
  repositoryRoot: string,
  outputs: readonly GeneratedOutput[],
) => Promise<GeneratedEvidence | undefined>

const VERSION = 1 as const
const OUTPUTS: readonly GeneratedOutput[] = ['compiled-app', 'ide-extension', 'parser']
const WRITER_OUTPUTS = new Map<string, readonly GeneratedOutput[]>([
  // The compile reads the ignored parser tree. Carrying its evidence here closes that dependency
  // even for a custom lane that invokes the app compiler without invoking the parser generator.
  ['_compile-word-flower-app', ['compiled-app', 'parser']],
  // The extension copies the generated TextMate grammar and an installed dprint WASM payload.
  // Its evidence therefore closes over the parser output as well as its own two output roots.
  ['_ide-extension-build', ['ide-extension', 'parser']],
  ['_parser-gen', ['parser']],
])

/** outputsForGates derives the ignored trees a lane creates or consumes through a generator node. */
function outputsForGates(gates: readonly string[]): GeneratedOutput[] {
  return [
    ...new Set(gates.flatMap(gate => WRITER_OUTPUTS.get(gate) ?? [])),
  ].sort()
}

/** isWriter reports whether a non-recordable node can be represented by generated evidence. */
function isWriter(gate: string): boolean {
  return WRITER_OUTPUTS.has(gate)
}

/**
 * capture identifies every requested ignored output and its non-Git inputs. Failure to read any
 * component means there is no reusable evidence; a cache miss is always safer than a partial key.
 */
async function capture(
  repositoryRoot: string,
  requested: readonly GeneratedOutput[],
): Promise<GeneratedEvidence | undefined> {
  const names = [...new Set(requested)].sort()
  if (names.some(name => !OUTPUTS.includes(name))) {
    return undefined
  }
  try {
    const outputs: Partial<Record<GeneratedOutput, GeneratedOutputEvidence>> = {}
    for (const name of names) {
      outputs[name] = await captureOutput(repositoryRoot, name)
    }
    return { outputs, version: VERSION }
  } catch {
    return undefined
  }
}

async function captureOutput(repositoryRoot: string, output: GeneratedOutput): Promise<GeneratedOutputEvidence> {
  if (output === 'parser') {
    const parserRoot = FS.resolvePath('packages/language/parser', repositoryRoot)
    return {
      inputs: await parserGenerateInputHash(parserRoot),
      outputs: await parserGenerateOutputHash(parserRoot),
    }
  }
  if (output === 'ide-extension') {
    const packageRoot = FS.resolvePath('packages/ides/ide-extension', repositoryRoot)
    const wasmPath = FS.resolvePath('packages/language/formatter/node_modules/@dprint/typescript/plugin.wasm', repositoryRoot)
    return {
      inputs: await FS.filesIdentity([['dprint-typescript/plugin.wasm', wasmPath]]),
      outputs: await directorySetsIdentity(packageRoot, [
        '_gen_ide-extension',
        'ide-extension-syntaxes/_gen_syntaxes',
      ]),
    }
  }
  const outputRoot = FS.resolvePath('packages/apps/expo-host/_gen_tao-app', repositoryRoot)
  return {
    // CompileApp's repository inputs are already covered by the enclosing visible-tree hash. The
    // declared stdlib is the one input allowed to live outside that tree.
    inputs: await TaoStdlib.declaredRootIdentity(repositoryRoot),
    outputs: await compileAppOutputHash(outputRoot),
  }
}

/** directorySetsIdentity hashes labelled generated roots, including their absence, in stable order. */
async function directorySetsIdentity(baseRoot: string, relativeRoots: readonly string[]): Promise<string> {
  const parts: string[] = []
  for (const relativeRoot of [...relativeRoots].sort()) {
    const root = FS.resolvePath(relativeRoot, baseRoot)
    if (!await FS.isDirectory(root)) {
      parts.push(`${relativeRoot}\n<absent>`)
      continue
    }
    const files: (readonly [string, string])[] = []
    for await (const path of FS.walk(root, { includeHidden: true })) {
      files.push([`${relativeRoot}/${FS.relativePath(root, path)}`, path])
    }
    parts.push(`${relativeRoot}\n${await FS.filesIdentity(files)}`)
  }
  return FS.contentIdentity(parts)
}

/** is validates the complete stored schema; unknown output names and versions fail closed. */
function is(value: unknown): value is GeneratedEvidence {
  if (!Json.isRecord(value) || value['version'] !== VERSION || !Json.isRecord(value['outputs'])) {
    return false
  }
  if (!Object.keys(value).every(key => key === 'outputs' || key === 'version')) {
    return false
  }
  const entries = Object.entries(value['outputs'])
  return entries.every(([name, entry]) =>
    OUTPUTS.includes(name as GeneratedOutput)
    && Json.isRecord(entry)
    && typeof entry['inputs'] === 'string'
    && typeof entry['outputs'] === 'string'
    && Object.keys(entry).every(key => key === 'inputs' || key === 'outputs')
  )
}

/** equals compares canonical fields rather than object insertion order. */
function equals(left: GeneratedEvidence | undefined, right: GeneratedEvidence | undefined): boolean {
  if (left === undefined || right === undefined || left.version !== right.version) {
    return left === right
  }
  const leftNames = Object.keys(left.outputs).sort()
  const rightNames = Object.keys(right.outputs).sort()
  return leftNames.length === rightNames.length
    && leftNames.every((name, index) => {
      if (name !== rightNames[index]) {
        return false
      }
      const leftEntry = left.outputs[name as GeneratedOutput]
      const rightEntry = right.outputs[name as GeneratedOutput]
      return leftEntry?.inputs === rightEntry?.inputs && leftEntry?.outputs === rightEntry?.outputs
    })
}

/** covers requires exactly the requested generated outputs, with no omitted or surplus evidence. */
function covers(evidence: GeneratedEvidence | undefined, requested: readonly GeneratedOutput[]): boolean {
  if (evidence === undefined) {
    return requested.length === 0
  }
  const present = Object.keys(evidence.outputs).sort()
  const wanted = [...new Set(requested)].sort()
  return present.length === wanted.length && present.every((name, index) => name === wanted[index])
}

export const GeneratedEvidence = {
  VERSION,
  capture,
  covers,
  equals,
  is,
  isWriter,
  outputsForGates,
} as const

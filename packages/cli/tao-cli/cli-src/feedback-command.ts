import { CLI, FS, HCI, Platform, TaoResources } from '@shared'
import { TaoVersion } from './tao-version'

/** Host probe output is untrusted; admit only known platform names and version shapes. */
const SAFE_TOKEN = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/
const VERSION_FIELD = /^v?[0-9]+(?:\.[0-9]+){1,2}$/
const APPLE_BUILD = /^[0-9]{1,3}[A-Z][0-9]{1,5}[a-z]?$/
const SHA256 = /^[0-9a-f]{64}$/
const ARCHITECTURES = new Set(['arm64', 'aarch64', 'x86_64', 'amd64'])
const KERNELS = new Set(['Darwin', 'Linux', 'Windows_NT'])
const ISSUE_ROOT = 'https://github.com/marcuswestin/tao-lang-2/issues/new?template='

type Component = { hash?: string; name: string; present: boolean; version?: string }
export type VisitorFingerprint = {
  architecture?: string
  kernel: { name?: string; version?: string }
  os: { build?: string; name?: string; version?: string }
  tao: { version?: string }
  toolchain: readonly Component[]
  version: 1
  xcode?: { build?: string; version?: string }
}

type ProbeOutput = {
  architecture?: string
  bunVersion?: string
  kernelName?: string
  kernelVersion?: string
  nodeVersion?: string
  osBuild?: string
  osName?: string
  osVersion?: string
  resourcesStamp?: string
  xcodeOutput?: string
}

function safeToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed !== undefined && SAFE_TOKEN.test(trimmed) ? trimmed : undefined
}

function versionToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed !== undefined && VERSION_FIELD.test(trimmed) ? trimmed.replace(/^v/, '') : undefined
}

function fromSet(value: string | undefined, allowed: ReadonlySet<string>): string | undefined {
  const trimmed = value?.trim()
  return trimmed !== undefined && allowed.has(trimmed) ? trimmed : undefined
}

function appleBuild(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed !== undefined && APPLE_BUILD.test(trimmed) ? trimmed : undefined
}

/** A pure boundary keeps hostile probe text out of the pasteable result. */
export function visitorFingerprint(probes: ProbeOutput): VisitorFingerprint {
  const resourceHash = probes.resourcesStamp?.trim()
  const xcodeLines = probes.xcodeOutput?.split('\n')
  const xcodeVersion = versionToken(/^Xcode (v?[0-9]+(?:\.[0-9]+){1,2})$/.exec(xcodeLines?.[0] ?? '')?.[1])
  const xcodeBuild = appleBuild(/^Build version ([0-9]{1,3}[A-Z][0-9]{1,5}[a-z]?)$/.exec(xcodeLines?.[1] ?? '')?.[1])
  return {
    architecture: fromSet(probes.architecture, ARCHITECTURES),
    kernel: { name: fromSet(probes.kernelName, KERNELS), version: versionToken(probes.kernelVersion) },
    os: {
      build: appleBuild(probes.osBuild),
      name: fromSet(probes.osName, new Set(['macOS'])),
      version: versionToken(probes.osVersion),
    },
    tao: { version: safeToken(TaoVersion.current()) },
    toolchain: [
      { name: 'bun', present: probes.bunVersion !== undefined, version: versionToken(probes.bunVersion) },
      { name: 'node', present: probes.nodeVersion !== undefined, version: versionToken(probes.nodeVersion) },
      {
        name: 'tao-resources',
        present: probes.resourcesStamp !== undefined,
        hash: resourceHash !== undefined && SHA256.test(resourceHash) ? resourceHash : undefined,
      },
    ],
    version: 1,
    ...(xcodeVersion === undefined && xcodeBuild === undefined
      ? {}
      : { xcode: { build: xcodeBuild, version: xcodeVersion } }),
  }
}

async function commandOutput(command: string, args: string[]): Promise<string | undefined> {
  const result = await CLI.run(command, { args })
  return result.error === undefined && result.exitCode === 0 ? result.stdout.trim() || undefined : undefined
}

/** Reads host facts only; it never needs a checkout or sends a report. */
async function readVisitorFingerprint(): Promise<VisitorFingerprint> {
  const [uname, macOs, xcodeOutput, nodeVersion] = await Promise.all([
    commandOutput('uname', ['-srm']),
    commandOutput('sw_vers', []),
    commandOutput('xcodebuild', ['-version']),
    commandOutput('node', ['--version']),
  ])
  const [kernelName, kernelVersion, architecture] = (uname ?? '').split(/\s+/)
  const os = new Map(
    (macOs ?? '').split('\n').map(line => {
      const [label, value] = line.split(/:\s+/, 2)
      return [label ?? '', value] as const
    }),
  )
  const root = TaoResources.declaredRoot()
  const resourcesStamp = root === undefined
    ? undefined
    : await FS.readText(FS.resolvePath(TaoResources.COMPLETION_STAMP, root)).catch(() => undefined)
  return visitorFingerprint({
    architecture,
    bunVersion: Platform.runtimeBunVersion,
    kernelName,
    kernelVersion,
    nodeVersion,
    osBuild: os.get('BuildVersion'),
    osName: os.get('ProductName'),
    osVersion: os.get('ProductVersion'),
    resourcesStamp,
    xcodeOutput,
  })
}

export async function runVisitorDoctor(options: { fingerprint?: boolean; json?: boolean }): Promise<void> {
  const fingerprint = await readVisitorFingerprint()
  if (options.fingerprint === true || options.json === true) {
    HCI.writeLine(JSON.stringify(fingerprint, null, 2))
    return
  }
  HCI.writeLine('Environment (safe to paste into a feedback report):')
  HCI.writeLine(JSON.stringify(fingerprint, null, 2))
  HCI.writeLine('Use `tao bug-report` to prepare a report and find the feedback forms.')
}

export async function runBugReport(): Promise<void> {
  const fingerprint = await readVisitorFingerprint()
  HCI.writeLine('Feedback draft (fill in the first three lines):')
  HCI.writeLine('What I was trying to build: …')
  HCI.writeLine('What I tried: …')
  HCI.writeLine('Where it stopped or confused me: …')
  HCI.writeLine('An unfinished attempt is useful; you do not need to reduce it first.')
  HCI.writeLine(`Could not build it: ${ISSUE_ROOT}could-not-build-it.yml`)
  HCI.writeLine(`Something confused me: ${ISSUE_ROOT}this-confused-me.yml`)
  HCI.writeLine('Paste this environment JSON into the form’s optional Environment field:')
  HCI.writeLine(JSON.stringify(fingerprint, null, 2))
  HCI.writeLine('Review the report before submitting it. Nothing was sent automatically.')
}

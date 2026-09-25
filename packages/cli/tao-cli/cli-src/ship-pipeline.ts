import { CLI, FS } from '@shared'
import type { ShipProgressPhaseId } from './ship-progress'

type ShipAppleCredentials = {
  issuerId: string
  keyId: string
  keyPath: string
}

export type ShipPipelineInput = ShipAppleCredentials & {
  archivePath: string
  exportPath: string
  runtimeRoot: string
  teamId: string
  xcodeProjectName: string
}

export type ShipCommandInvocation = {
  args: string[]
  command: string
  cwd: string
  env?: Record<string, string>
}

export type ShipPipelinePlan = {
  archive: ShipCommandInvocation
  exportArchive: ShipCommandInvocation
  exportOptionsPath: string
  exportOptionsPlist: string
  installPods: ShipCommandInvocation
  prebuild: ShipCommandInvocation
}

export type ShipCommandRunner = (
  command: string,
  spec: {
    args: readonly string[]
    cwd: string
    env?: Record<string, string>
    prefixedOutput?: { logFile?: FS.FileHandle; processName: string; terminal?: boolean }
  },
) => Promise<unknown>

export type ShipPipelineRunOptions = {
  logFile?: FS.FileHandle
  onPhase?: (phase: ShipProgressPhaseId) => void
}

/** planShipPipeline makes every Apple command argument a pure function of manifest-derived input. */
export function planShipPipeline(input: ShipPipelineInput): ShipPipelinePlan {
  const workspace = FS.resolvePath(`ios/${input.xcodeProjectName}.xcworkspace`, input.runtimeRoot)
  const derivedDataPath = FS.resolvePath('.artifacts/ship/DerivedData', input.runtimeRoot)
  const exportOptionsPath = FS.resolvePath('.artifacts/ship/ExportOptions.plist', input.runtimeRoot)
  const cocoaPodsHome = FS.resolvePath('.artifacts/cocoapods', input.runtimeRoot)
  const authentication = [
    '-authenticationKeyPath',
    input.keyPath,
    '-authenticationKeyID',
    input.keyId,
    '-authenticationKeyIssuerID',
    input.issuerId,
  ]
  return {
    prebuild: {
      command: FS.resolvePath('node_modules/.bin/expo', input.runtimeRoot),
      args: ['prebuild', '--platform', 'ios', '--no-install'],
      cwd: input.runtimeRoot,
    },
    installPods: {
      command: 'pod',
      args: ['install', '--ansi'],
      cwd: FS.resolvePath('ios', input.runtimeRoot),
      env: { CP_HOME_DIR: cocoaPodsHome, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    },
    archive: {
      command: 'xcodebuild',
      args: [
        '-workspace',
        workspace,
        '-scheme',
        input.xcodeProjectName,
        '-configuration',
        'Release',
        '-archivePath',
        input.archivePath,
        '-derivedDataPath',
        derivedDataPath,
        '-allowProvisioningUpdates',
        `DEVELOPMENT_TEAM=${input.teamId}`,
        ...authentication,
        'archive',
      ],
      cwd: input.runtimeRoot,
    },
    exportArchive: {
      command: 'xcodebuild',
      args: [
        '-exportArchive',
        '-archivePath',
        input.archivePath,
        '-exportPath',
        input.exportPath,
        '-exportOptionsPlist',
        exportOptionsPath,
        '-allowProvisioningUpdates',
        ...authentication,
      ],
      cwd: input.runtimeRoot,
    },
    exportOptionsPath,
    exportOptionsPlist: exportOptionsPlist(input.teamId),
  }
}

/** planUnsignedArchive proves native generation and compilation without touching Apple credentials. */
export function planUnsignedArchive(
  input: Pick<ShipPipelineInput, 'archivePath' | 'runtimeRoot' | 'xcodeProjectName'>,
): ShipCommandInvocation {
  return {
    command: 'xcodebuild',
    args: [
      '-workspace',
      FS.resolvePath(`ios/${input.xcodeProjectName}.xcworkspace`, input.runtimeRoot),
      '-scheme',
      input.xcodeProjectName,
      '-configuration',
      'Release',
      '-archivePath',
      input.archivePath,
      '-derivedDataPath',
      FS.resolvePath('.artifacts/ship/DerivedData', input.runtimeRoot),
      'CODE_SIGNING_ALLOWED=NO',
      'CODE_SIGNING_REQUIRED=NO',
      'archive',
    ],
    cwd: input.runtimeRoot,
  }
}

export async function runShipPipeline(
  plan: ShipPipelinePlan,
  runner: ShipCommandRunner = CLI.mustRun,
  options: ShipPipelineRunOptions = {},
): Promise<void> {
  await FS.writeText(plan.exportOptionsPath, plan.exportOptionsPlist)
  await FS.mkdir(plan.installPods.env!['CP_HOME_DIR']!)
  const invocations = [
    { invocation: plan.prebuild, phase: 'ios-project' as const, processName: 'expo' },
    { invocation: plan.installPods, phase: 'ios-dependencies' as const, processName: 'pods' },
    { invocation: plan.archive, phase: 'ios-archive' as const, processName: 'ship' },
    { invocation: plan.exportArchive, phase: 'upload' as const, processName: 'ship' },
  ]
  for (const { invocation, phase, processName } of invocations) {
    options.onPhase?.(phase)
    await runner(invocation.command, {
      args: invocation.args,
      cwd: invocation.cwd,
      env: invocation.env,
      prefixedOutput: {
        logFile: options.logFile,
        processName,
        terminal: options.logFile === undefined,
      },
    })
  }
}

function exportOptionsPlist(teamId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>destination</key>
  <string>upload</string>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${teamId}</string>
</dict>
</plist>
`
}

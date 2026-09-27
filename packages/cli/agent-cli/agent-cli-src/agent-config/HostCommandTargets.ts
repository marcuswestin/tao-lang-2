export type HostCommandTarget = {
  argsPolicy?: 'none' | 'pid' | 'standalone-vm' | 'studio-list' | 'studio-stop'
  command: string
  /** Environment the tool needs whatever shell dispatches it, merged over the inherited one. */
  env?: Readonly<Record<string, string>>
  fixedArgs: readonly string[]
  server?: boolean
}

/**
 * CocoaPods refuses to read podspecs under a non-UTF-8 locale, failing with an `ASCII-8BIT`
 * normalization error, and the shell an agent's host operation runs in carries no `LANG`.
 */
const UTF8_LOCALE = { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } as const

/** Implementations for named host operations. Permissions still come solely from agentHostCommands. */
export const HOST_COMMAND_TARGETS: Readonly<Record<string, HostCommandTarget>> = {
  'merge-recover': { command: './dev', fixedArgs: ['merge-recover'] },
  // Keep read-only reclaim sandboxed; only its guarded removal action needs host filesystem access.
  'reclaim --execute': { command: './dev', fixedArgs: ['reclaim', '--execute'], argsPolicy: 'none' },
  'prepare-release studio': { command: './dev', fixedArgs: ['prepare-release', 'studio'] },
  'prepare-release ide-extension': { command: './dev', fixedArgs: ['prepare-release', 'ide-extension'] },
  'app-dev': { command: './tao', fixedArgs: ['dev'], server: true },
  // Dev loops that watch files run on the host, where Watchman and the OS file-event service are
  // reachable; no agent sandbox is given Watchman's per-login socket. The recipes generate the parser
  // first, since Studio's highlighter reads the generated grammar.
  'studio': { command: 'just', fixedArgs: ['studio'], server: true },
  'studio-native': { command: 'just', fixedArgs: ['studio-native'], server: true },
  'studio-ps': { command: './dev', fixedArgs: ['studio-ps'], argsPolicy: 'studio-list' },
  'studio-stop': { command: './dev', fixedArgs: ['studio-stop'], argsPolicy: 'studio-stop' },
  'docker-desktop start': { command: 'open', fixedArgs: ['-a', 'Docker'], argsPolicy: 'none' },
  // One daemon serves this login's worktrees; no arbitrary Watchman commands or socket overrides.
  'watchman start': { command: './dev', fixedArgs: ['watchman', 'start'], argsPolicy: 'none' },
  'watchman status': { command: './dev', fixedArgs: ['watchman', 'status'], argsPolicy: 'none' },
  'watchman stop': { command: './dev', fixedArgs: ['watchman', 'stop'], argsPolicy: 'none' },
  // The local InstantDB stack is Docker Compose; running its two recipes on the host keeps the Docker
  // socket, which is root-equivalent, out of every agent sandbox.
  'local-instantdb start': { command: 'just', fixedArgs: ['start-local-instantdb'], argsPolicy: 'none' },
  'local-instantdb stop': { command: 'just', fixedArgs: ['stop-local-instantdb'], argsPolicy: 'none' },
  // CocoaPods, xcodebuild, and Gradle each need the host, and the build runs all three as one
  // sequence; naming the whole build keeps an agent from stitching it together from lower-level
  // operations and a hand-written placement step.
  'companion-host-build': { command: './dev', fixedArgs: ['companion-host-build'] },
  'setup-ios': { command: './dev', fixedArgs: ['setup-ios'] },
  'setup-visionos': { command: './dev', fixedArgs: ['setup-visionos'] },
  'standalone-cli-vm-setup': { command: 'just', fixedArgs: ['standalone-cli-vm-setup'], argsPolicy: 'none' },
  'standalone-cli-clean-machine': {
    command: 'just',
    fixedArgs: ['standalone-cli-clean-machine'],
    argsPolicy: 'standalone-vm',
  },
  'simulators list': { command: 'xcrun', fixedArgs: ['simctl', 'list', 'devices'] },
  'simulators boot': { command: 'xcrun', fixedArgs: ['simctl', 'boot'] },
  'simulators run': { command: 'xcrun', fixedArgs: ['simctl', 'boot'] },
  'simulators app-container': { command: 'xcrun', fixedArgs: ['simctl', 'get_app_container'] },
  'simulators install': { command: 'xcrun', fixedArgs: ['simctl', 'install'] },
  'simulators launch': { command: 'xcrun', fixedArgs: ['simctl', 'launch'] },
  'simulators open-url': { command: 'xcrun', fixedArgs: ['simctl', 'openurl'] },
  'simulators uninstall': { command: 'xcrun', fixedArgs: ['simctl', 'uninstall'] },
  'simulators open': { command: 'open', fixedArgs: ['-a', 'Simulator'] },
  'devices list': { command: 'xcrun', fixedArgs: ['devicectl', 'list', 'devices'] },
  'devices apps': { command: 'xcrun', fixedArgs: ['devicectl', 'device', 'info', 'apps'] },
  'devices launch': { command: 'xcrun', fixedArgs: ['devicectl', 'device', 'process', 'launch'] },
  'xcode version': { command: 'xcodebuild', fixedArgs: ['-version'], argsPolicy: 'none' },
  'xcode setup-status': { command: 'xcodebuild', fixedArgs: ['-checkFirstLaunchStatus'], argsPolicy: 'none' },
  'xcode sdks': { command: 'xcodebuild', fixedArgs: ['-showsdks'], argsPolicy: 'none' },
  'xcode build-project': { command: 'xcodebuild', fixedArgs: ['-project'] },
  'xcode build-workspace': { command: 'xcodebuild', fixedArgs: ['-workspace'] },
  'xcode export-archive': { command: 'xcodebuild', fixedArgs: ['-exportArchive'] },
  'pods install': { command: 'pod', env: UTF8_LOCALE, fixedArgs: ['install'] },
  'pods spec': { command: 'pod', env: UTF8_LOCALE, fixedArgs: ['ipc', 'spec'] },
  'android devices': { command: 'adb', fixedArgs: ['devices'], argsPolicy: 'none' },
  'android state': { command: 'adb', fixedArgs: ['get-state'], argsPolicy: 'none' },
  'android emulators': { command: 'emulator', fixedArgs: ['-list-avds'], argsPolicy: 'none' },
  'android boot': { command: 'emulator', fixedArgs: ['-avd'], server: true },
  'android ensure': { command: './dev', fixedArgs: ['android-emulator'], argsPolicy: 'none' },
  'remote fetch': { command: 'git', fixedArgs: ['fetch', 'origin'] },
  'remote refs': { command: 'git', fixedArgs: ['ls-remote', 'origin'] },
  'remote heads': { command: 'git', fixedArgs: ['ls-remote', '--heads', 'origin'] },
  'remote exists': { command: 'git', fixedArgs: ['ls-remote', '--exit-code', 'origin'] },
  'processes list': { command: 'ps', fixedArgs: ['-axo', 'pid=,ppid=,lstart=,command='], argsPolicy: 'none' },
  'processes started': { command: 'ps', fixedArgs: ['-o', 'lstart=', '-p'], argsPolicy: 'pid' },
  'start-branch': { command: './dev', fixedArgs: ['start-branch'] },
}

/** A named operation has a fixed implementation; suffix argv passes through without a shell. */
export function hostCommandTarget(prefix: readonly string[]): HostCommandTarget | undefined {
  return HOST_COMMAND_TARGETS[prefix.join(' ')]
}

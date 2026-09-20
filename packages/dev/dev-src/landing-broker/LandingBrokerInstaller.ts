import { CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'
import { landingBrokerIsReady } from './LandingBrokerClient'
import {
  LANDING_BROKER_LABEL,
  LANDING_BROKER_VERSION,
  landingBrokerBinaryPath,
  type LandingBrokerConfig,
  landingBrokerConfigPath,
  landingBrokerLaunchAgentPath,
  type LandingBrokerRepository,
  landingBrokerRoot,
  landingBrokerSocketPath,
} from './LandingBrokerProtocol'

const START_TIMEOUT_MS = 5_000

export const LandingBrokerInstaller = {
  /** Install a bundled, immutable-to-the-sandbox broker and register this repository with it. */
  async install(repositoryRoot = Repo.getRoot()): Promise<void> {
    const root = FS.resolvePath(repositoryRoot)
    const [gitCommonDir, remoteUrl, bunPath, gitPath, ghPath, uid] = await Promise.all([
      commandLine('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], root),
      commandLine('git', ['remote', 'get-url', 'origin'], root),
      commandLine('which', ['bun'], root),
      commandLine('which', ['git'], root),
      commandLine('which', ['gh'], root),
      commandLine('id', ['-u'], root),
    ])
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u.test(remoteUrl)) {
      Errors.throwUserInput(`Landing broker installation requires a stored GitHub HTTPS origin, not '${remoteUrl}'.`)
    }
    const canonicalGitDir = await FS.realPath(gitCommonDir)
    const objectDirectory = await FS.realPath(FS.resolvePath('objects', canonicalGitDir))
    const brokerRoot = landingBrokerRoot()
    const repositoryKey = Platform.sha256Hex(canonicalGitDir).slice(0, 16)
    const mirrorGitDir = FS.resolvePath(`repositories/${repositoryKey}.git`, brokerRoot)

    await FS.mkdir(brokerRoot)
    await FS.chmod(brokerRoot, 0o700)
    if (!await FS.isFile(FS.resolvePath('HEAD', mirrorGitDir))) {
      await CLI.mustRun(gitPath, { args: ['init', '--bare', '--quiet', mirrorGitDir], cwd: root })
    }
    await FS.chmod(FS.dirname(mirrorGitDir), 0o700)
    await FS.chmod(mirrorGitDir, 0o700)

    const repository: LandingBrokerRepository = {
      gitCommonDir: canonicalGitDir,
      mirrorGitDir,
      objectDirectory,
      remoteUrl,
    }
    const current = await readExistingConfig()
    const repositories = [
      ...(current?.repositories ?? []).filter(candidate => candidate.gitCommonDir !== canonicalGitDir),
      repository,
    ]
    const config: LandingBrokerConfig = {
      ghPath: await FS.realPath(ghPath),
      gitPath: await FS.realPath(gitPath),
      repositories,
      socketPath: landingBrokerSocketPath(),
      version: LANDING_BROKER_VERSION,
    }

    const buildOutput = FS.resolvePath('.artifacts/build/tao-landing-broker.js', root)
    const entry = FS.resolvePath('packages/dev/dev-src/landing-broker/LandingBrokerServer.ts', root)
    await FS.mkdir(FS.dirname(buildOutput))
    await FS.remove(buildOutput)
    const canonicalBunPath = await FS.realPath(bunPath)
    await CLI.mustRun(canonicalBunPath, {
      args: ['build', entry, '--target=bun', '--outfile', buildOutput],
      cwd: root,
      stdio: 'stream',
    })
    const nextBinary = `${landingBrokerBinaryPath()}.next`
    await FS.copyFile(buildOutput, nextBinary)
    await FS.chmod(nextBinary, 0o600)
    await FS.move(nextBinary, landingBrokerBinaryPath())
    await FS.writeJson(landingBrokerConfigPath(), config, { mode: 0o600 })
    await FS.chmod(landingBrokerConfigPath(), 0o600)

    const logRoot = FS.resolvePath('Library/Logs/Tao', FS.homeDir())
    await FS.mkdir(logRoot)
    await FS.writeText(landingBrokerLaunchAgentPath(), launchAgentPlist(logRoot, canonicalBunPath), { mode: 0o600 })
    await FS.chmod(landingBrokerLaunchAgentPath(), 0o600)
    const domain = `gui/${uid}`
    await CLI.run('launchctl', { args: ['bootout', `${domain}/${LANDING_BROKER_LABEL}`], cwd: root })
    await CLI.mustRun('launchctl', { args: ['bootstrap', domain, landingBrokerLaunchAgentPath()], cwd: root })
    await CLI.mustRun('launchctl', { args: ['kickstart', '-k', `${domain}/${LANDING_BROKER_LABEL}`], cwd: root })
    await waitUntilReady()
    HCI.writeSuccess(`PASS  Installed the Tao landing broker for ${remoteUrl}.\n`)
  },
} as const

async function readExistingConfig(): Promise<LandingBrokerConfig | undefined> {
  if (!await FS.isFile(landingBrokerConfigPath())) {
    return undefined
  }
  const config = await FS.readJson<LandingBrokerConfig>(landingBrokerConfigPath())
  if (config.version !== LANDING_BROKER_VERSION || !Array.isArray(config.repositories)) {
    Errors.throwHostEnvironment(`The existing landing broker config is unsupported: ${landingBrokerConfigPath()}`)
  }
  return config
}

async function commandLine(command: string, args: readonly string[], cwd: string): Promise<string> {
  const line = (await CLI.mustRun(command, { args, cwd })).stdout.trim().split('\n')[0]?.trim() ?? ''
  if (line === '') {
    Errors.throwHostEnvironment(`Command returned no value: ${command} ${args.join(' ')}`)
  }
  return line
}

async function waitUntilReady(): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < START_TIMEOUT_MS) {
    if (await landingBrokerIsReady().catch(() => false)) {
      return
    }
    await Time.sleep(100)
  }
  Errors.throwHostEnvironment(
    `The landing broker did not start. Inspect ~/Library/Logs/Tao/landing-broker.{out,err}.log.`,
  )
}

function launchAgentPlist(logRoot: string, bunPath: string): string {
  const values = {
    binary: xmlEscape(landingBrokerBinaryPath()),
    bun: xmlEscape(bunPath),
    config: xmlEscape(landingBrokerConfigPath()),
    errorLog: xmlEscape(FS.resolvePath('landing-broker.err.log', logRoot)),
    label: xmlEscape(LANDING_BROKER_LABEL),
    outputLog: xmlEscape(FS.resolvePath('landing-broker.out.log', logRoot)),
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${values.label}</string>
  <key>ProgramArguments</key>
  <array><string>${values.bun}</string><string>${values.binary}</string><string>serve</string><string>${values.config}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${values.outputLog}</string>
  <key>StandardErrorPath</key><string>${values.errorLog}</string>
</dict>
</plist>
`
}

function xmlEscape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

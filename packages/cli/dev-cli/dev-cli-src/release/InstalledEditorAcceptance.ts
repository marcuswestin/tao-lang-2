import { CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'

const VSIX = '.artifacts/build/tao-ide-extension.vsix'
const PROBE = 'packages/ides/ide-extension/ide-extension-acceptance'
const PHASES = [
  'started',
  'activation',
  'hover',
  'definitions',
  'contracts',
  'origin',
  'Tao diagnostics',
  'sidecar',
  'recovery',
] as const
const STARTUP_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 540_000

type LaunchSeams = {
  commandPath: typeof CLI.commandPath
  realPath: typeof FS.realPath
  isFile: typeof FS.isFile
  start: typeof CLI.start
  sleep: typeof Time.sleep
  nowMs: typeof Time.nowMs
  writeLine: typeof HCI.writeLine
}

type ProfileSeams = {
  mkTmpDir: typeof FS.mkTmpDir
  isDirectory: typeof FS.isDirectory
  writeJson: typeof FS.writeJson
  copyDirectory: typeof FS.copyDirectory
  remove: typeof FS.remove
}

const liveProfileSeams: ProfileSeams = {
  mkTmpDir: FS.mkTmpDir,
  isDirectory: FS.isDirectory,
  writeJson: FS.writeJson,
  copyDirectory: FS.copyDirectory,
  remove: FS.remove,
}

/** Keep the editor IPC socket short while preserving its disposable profile as run evidence. */
export async function withEditorProfile<T>(
  root: string,
  action: (user: string) => Promise<T>,
  seams: ProfileSeams = liveProfileSeams,
): Promise<T> {
  const user = await seams.mkTmpDir(Platform.hostPlatform === 'win32' ? 'tao-ide-' : '/tmp/tao-ide-')
  const logs = FS.resolvePath('logs', user)
  const archive = FS.resolvePath('user-logs', root)
  const metadata = FS.resolvePath('external-profile.json', root)
  const record = {
    path: user,
    owner: 'installed-editor-acceptance',
    purpose: 'Disposable isolated VS Code user profile with a short IPC socket path',
    cleanup: `Copy ${logs} to ${archive} when present, then remove only ${user} when this run ends.`,
  }
  let actionError: Error | undefined
  let accepted!: T
  try {
    await seams.writeJson(metadata, { ...record, status: 'active' })
    accepted = await action(user)
  } catch (error) {
    actionError = Errors.asError(error)
  }
  let archiveError: Error | undefined
  let removalError: Error | undefined
  let metadataError: Error | undefined
  let logsPresent = false
  try {
    logsPresent = await seams.isDirectory(logs)
    if (logsPresent) {
      await seams.copyDirectory(logs, archive)
    }
  } catch (error) {
    archiveError = Errors.asError(error)
  } finally {
    try {
      await seams.remove(user)
    } catch (error) {
      removalError = Errors.asError(error)
    }
  }
  try {
    await seams.writeJson(metadata, {
      ...record,
      status: removalError === undefined ? 'removed' : 'cleanup-required',
      archive: archiveError === undefined && logsPresent ? archive : undefined,
      archiveError: archiveError?.message,
      removalError: removalError?.message,
    })
  } catch (error) {
    metadataError = Errors.asError(error)
  }
  if (archiveError !== undefined || removalError !== undefined || metadataError !== undefined) {
    Errors.throwHostEnvironment(
      `${actionError === undefined ? '' : `${actionError.message}\n`}Editor profile cleanup failed for ${user}:`
        + ` archive ${archiveError?.message ?? 'passed'}; remove ${removalError?.message ?? 'passed'};`
        + ` metadata ${metadataError?.message ?? 'passed'}.`,
    )
  }
  if (actionError !== undefined) {
    Errors.throwHostEnvironment(actionError.message)
  }
  return accepted
}

const liveLaunchSeams: LaunchSeams = {
  commandPath: CLI.commandPath,
  realPath: FS.realPath,
  isFile: FS.isFile,
  start: CLI.start,
  sleep: Time.sleep,
  nowMs: Time.nowMs,
  writeLine: HCI.writeLine,
}

function phasePath(root: string, index: number): string {
  return FS.resolvePath(`progress/${index}-${PHASES[index]}.json`, root)
}

/** Resolve the application binary behind the installed editor's shell CLI. */
export async function editorExecutable(codeCli: string, seams: LaunchSeams = liveLaunchSeams): Promise<string> {
  const path = codeCli.includes('/') || codeCli.includes('\\') ? codeCli : await seams.commandPath(codeCli)
  if (path === undefined || !await seams.isFile(path)) {
    Errors.throwHostEnvironment(`The configured VS Code CLI was not found: ${codeCli}.`)
  }
  const resolved = await seams.realPath(path)
  const cliDirectory = FS.dirname(resolved)
  const candidates = Platform.hostPlatform === 'darwin'
    ? [FS.resolvePath('../../../MacOS/Code', cliDirectory)]
    : Platform.hostPlatform === 'win32'
    ? [FS.resolvePath('../Code.exe', cliDirectory)]
    : [FS.resolvePath('../code', cliDirectory)]
  for (const candidate of candidates) {
    if (await seams.isFile(candidate)) {
      return candidate
    }
  }
  Errors.throwHostEnvironment(
    `Could not find the VS Code application executable for CLI ${resolved}. Checked: ${candidates.join(', ')}.`,
  )
}

type ProbeLaunch = {
  codeCli: string
  profileArgs: string[]
  probe: string
  probeBundle: string
  workspace: string
  root: string
  env: Platform.ProcessEnv
}

/** Run an installed extension test in the native editor and require its probe receipt. */
export async function launchProbe(options: ProbeLaunch, seams: LaunchSeams = liveLaunchSeams): Promise<string> {
  const executable = await editorExecutable(options.codeCli, seams)
  const args = [
    ...options.profileArgs,
    '--new-window',
    '--disable-updates',
    '--disable-workspace-trust',
    '--log',
    'trace',
    '--extensionDevelopmentPath',
    options.probe,
    '--extensionTestsPath',
    options.probeBundle,
    options.workspace,
  ]
  const marker = FS.resolvePath('probe-passed.json', options.root)
  let stdout = ''
  let stderr = ''
  const child = seams.start(executable, {
    args,
    cwd: Repo.getRoot(),
    env: options.env,
    processPolicy: 'test',
    stdio: 'pipe',
    timeoutMs: PROBE_TIMEOUT_MS,
    onOutput: (stream, chunk) => {
      const output = chunk.toString('utf8')
      if (stream === 'stdout') {
        stdout = (stdout + output).slice(-4_000)
      } else {
        stderr = (stderr + output).slice(-4_000)
      }
    },
  })
  let closed: { exitCode: number | null; signal: Platform.ProcessSignal | null } | undefined
  child.onceClose((exitCode, signal) => {
    closed = { exitCode, signal }
  })
  let lastPhase = 'launching'
  let nextPhase = 0
  const startedAt = seams.nowMs()
  try {
    while (closed === undefined) {
      while (nextPhase < PHASES.length && await seams.isFile(phasePath(options.root, nextPhase))) {
        lastPhase = PHASES[nextPhase]!
        seams.writeLine(`Installed editor probe: ${lastPhase}`)
        nextPhase += 1
      }
      if (nextPhase === 0 && seams.nowMs() - startedAt >= STARTUP_TIMEOUT_MS) {
        Errors.throwHostEnvironment('The installed editor probe did not start within 120s.')
      }
      await seams.sleep(250)
    }
    while (nextPhase < PHASES.length && await seams.isFile(phasePath(options.root, nextPhase))) {
      lastPhase = PHASES[nextPhase]!
      seams.writeLine(`Installed editor probe: ${lastPhase}`)
      nextPhase += 1
    }
    if (child.error !== undefined || closed.exitCode !== 0 || !await seams.isFile(marker)) {
      Errors.throwHostEnvironment(
        `The installed editor probe exited without a passing result (exit ${closed.exitCode}, signal ${
          closed.signal ?? 'none'
        }, error ${child.error?.message ?? 'none'}).`,
      )
    }
    return executable
  } catch (error) {
    if (closed === undefined) {
      child.kill('SIGTERM')
      await child.waitForClose()
    }
    const reason = Errors.asError(error).message
    Errors.throwHostEnvironment(
      `${reason}\nExecutable: ${executable}\nProfile: ${options.profileArgs.join(' ')}\nEvidence: ${options.root}`
        + `\nLast phase: ${lastPhase}\nstdout (tail): ${stdout.trim() || '(empty)'}`
        + `\nstderr (tail): ${stderr.trim() || '(empty)'}`,
    )
  } finally {
    await child.closeOutput()
  }
}

type ExtensionManifest = { name?: unknown; publisher?: unknown; version?: unknown }

async function runCommand(
  command: string,
  args: readonly string[],
  env?: Platform.ProcessEnv,
  timeoutMs?: number,
): Promise<string> {
  const result = await CLI.run(command, {
    args,
    cwd: Repo.getRoot(),
    env,
    processPolicy: timeoutMs === undefined ? 'tool' : 'test',
    stdio: 'pipe',
    timeoutMs,
  })
  if (result.error !== undefined || result.exitCode !== 0) {
    const detail = result.error?.message ?? (result.stderr.trim() || result.stdout.trim())
    Errors.throwHostEnvironment(`${command} ${args[0] ?? ''} failed: ${detail || `exit ${result.exitCode}`}`)
  }
  return result.stdout.trim()
}

async function vscodeCli(): Promise<string> {
  const explicit = Platform.runtimeProcess.env['TAO_VSCODE_CLI']
  if (explicit !== undefined && explicit !== '') {
    return explicit
  }
  const macApp = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
  return await FS.isFile(macApp) ? macApp : 'code'
}

async function run(): Promise<void> {
  HCI.writeLine('Packaging the Tao IDE extension ...')
  await runCommand('./agent', ['ide-extension-package'])
  const vsix = Repo.resolvePath(VSIX)
  if (!await FS.isFile(vsix)) {
    Errors.throwHostEnvironment(`The IDE package did not write ${vsix}.`)
  }
  const manifest = await FS.readJson<ExtensionManifest>(Repo.resolvePath('packages/ides/ide-extension/package.json'))
  if (
    typeof manifest.name !== 'string' || typeof manifest.publisher !== 'string'
    || typeof manifest.version !== 'string'
  ) {
    Errors.throwUserInput('The IDE extension manifest needs a name, publisher, and version.')
  }
  const identity = `${manifest.publisher}.${manifest.name}`
  const version = manifest.version
  const root = Repo.resolvePath(`.artifacts/tests/ide-installed/${Date.now()}-${Platform.runtimeProcess.pid}`)
  const workspace = await Repo.mkScratchDir('tao-ide-installed-')
  await FS.writeJson(FS.resolvePath('workspace.json', root), {
    path: workspace,
    owner: 'installed-editor-acceptance',
    purpose: 'Authored Tao acceptance project discoverable by repository file scans',
    cleanup: 'Retain with run evidence until the acceptance result has been reviewed.',
  })
  const accepted = await withEditorProfile(root, async user => {
    const extensions = FS.resolvePath('extensions', root)
    HCI.writeLine('Preparing an isolated editor workspace and profile ...')
    await FS.writeText(FS.resolvePath('.tao/.gitkeep', workspace), '')
    await FS.writeText(
      FS.resolvePath('Definitions.tao', workspace),
      '/** A greeting declared in another Tao file. */\nproject let Greeting = "Hello"\n',
    )
    await FS.writeText(
      FS.resolvePath('Main.tao', workspace),
      'use Greeting from ./Definitions\nlet Caption = Greeting\n',
    )
    await FS.writeText(
      FS.resolvePath('Functions.tao', workspace),
      'function CountWords(Value text) returns number {\n  return CountWords(Value) from ./Words.ts\n}\n',
    )
    await FS.writeText(
      FS.resolvePath('Words.ts', workspace),
      'export function CountWords(value: string): number { return value.length }\n',
    )

    const code = await vscodeCli()
    const profileArgs = ['--user-data-dir', user, '--extensions-dir', extensions]
    HCI.writeLine(`Installing ${identity} in the isolated profile ...`)
    await runCommand(code, [...profileArgs, '--install-extension', vsix, '--force'])
    HCI.writeLine('Checking the installed extension version ...')
    const installed = await runCommand(code, [...profileArgs, '--list-extensions', '--show-versions'])
    const expected = `${identity}@${version}`
    if (!installed.split('\n').some(line => line.trim().toLowerCase() === expected.toLowerCase())) {
      Errors.throwHostEnvironment(`VS Code did not list ${expected} in the isolated profile.`)
    }
    HCI.writeLine('Recording the installed editor version ...')
    const editorVersion = (await runCommand(code, [...profileArgs, '--version'])).split('\n')[0]?.trim()
    if (editorVersion === undefined || editorVersion === '') {
      Errors.throwHostEnvironment('The installed editor CLI did not report its version.')
    }

    const probe = Repo.resolvePath(PROBE)
    const probeBundle = FS.resolvePath('probe-test.cjs', root)
    HCI.writeLine('Building the editor acceptance probe ...')
    await runCommand('bun', [
      'build',
      FS.resolvePath('test.ts', probe),
      '--target=node',
      '--format=cjs',
      '--external=vscode',
      `--outfile=${probeBundle}`,
      '--reject-unresolved',
    ])
    if (!await FS.isFile(probeBundle)) {
      Errors.throwHostEnvironment(`The editor probe bundle did not write ${probeBundle}.`)
    }
    const env: Platform.ProcessEnv = {
      ...Platform.runtimeProcess.env,
      TAO_EDITOR_ACCEPTANCE_ROOT: workspace,
      TAO_EDITOR_EXPECTED_EXTENSION: identity,
      TAO_EDITOR_EXPECTED_VERSION: version,
      TAO_EDITOR_EXTENSIONS_DIR: extensions,
      TAO_EDITOR_ACCEPTANCE_MARKER: FS.resolvePath('probe-passed.json', root),
      TAO_EDITOR_ACCEPTANCE_PROGRESS: FS.resolvePath('progress', root),
    }
    HCI.writeLine(`Launching the isolated VS Code installed-extension probe for ${expected}.`)
    const executable = await launchProbe({ codeCli: code, profileArgs, probe, probeBundle, workspace, root, env })
    return { executable, expected, workspace, editorVersion }
  })
  await FS.writeJson(FS.resolvePath('receipt.json', root), {
    extension: accepted.expected,
    executable: accepted.executable,
    editorVersion: accepted.editorVersion,
    workspace: accepted.workspace,
    probe: 'activation, hover, definition, diagnostics, disk contracts, sidecar recovery, source origin',
    result: 'passed',
  })
  HCI.writeLine(
    `Installed IDE acceptance passed for ${accepted.expected}; receipt: ${FS.resolvePath('receipt.json', root)}`,
  )
}

export const InstalledEditorAcceptance = { run } as const

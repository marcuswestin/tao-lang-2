import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

const VSIX = '.artifacts/build/tao-ide-extension.vsix'
const PROBE = 'packages/ides/ide-extension/ide-extension-acceptance'

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
  const root = Repo.resolvePath(`.artifacts/tests/ide-installed/${Date.now()}-${Platform.runtimeProcess.pid}`)
  const workspace = FS.resolvePath('workspace', root)
  const user = FS.resolvePath('user', root)
  const extensions = FS.resolvePath('extensions', root)
  HCI.writeLine('Preparing an isolated editor workspace and profile ...')
  await FS.writeText(FS.resolvePath('.tao/.gitkeep', workspace), '')
  await FS.writeText(
    FS.resolvePath('Definitions.tao', workspace),
    '/** A greeting declared in another Tao file. */\nproject let Greeting = "Hello"\n',
  )
  await FS.writeText(FS.resolvePath('Main.tao', workspace), 'use Greeting from ./Definitions\nlet Caption = Greeting\n')
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
  const expected = `${identity}@${manifest.version}`
  if (!installed.split('\n').some(line => line.trim().toLowerCase() === expected.toLowerCase())) {
    Errors.throwHostEnvironment(`VS Code did not list ${expected} in the isolated profile.`)
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
    TAO_EDITOR_EXPECTED_VERSION: manifest.version,
    TAO_EDITOR_EXTENSIONS_DIR: extensions,
    TAO_EDITOR_ACCEPTANCE_MARKER: FS.resolvePath('probe-passed.json', root),
  }
  HCI.writeLine(`Launching the isolated VS Code installed-extension probe for ${expected}.`)
  await runCommand(
    code,
    [
      ...profileArgs,
      '--new-window',
      '--wait',
      '--extensionDevelopmentPath',
      probe,
      '--extensionTestsPath',
      probeBundle,
      workspace,
    ],
    env,
    540_000,
  )
  if (!await FS.isFile(FS.resolvePath('probe-passed.json', root))) {
    Errors.throwHostEnvironment('The installed IDE probe exited without its success marker.')
  }
  await FS.writeJson(FS.resolvePath('receipt.json', root), {
    extension: expected,
    workspace,
    probe: 'activation, hover, definition, diagnostics, disk contracts, sidecar recovery, source origin',
    result: 'passed',
  })
  HCI.writeLine(`Installed IDE acceptance passed for ${expected}; receipt: ${FS.resolvePath('receipt.json', root)}`)
}

export const InstalledEditorAcceptance = { run } as const

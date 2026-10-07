import { CLI, Errors, FS, HCI, Platform, ProjectLocal, Repo, Text, waitForProcessReadiness } from '@shared'
import { StandaloneScenarios } from './standalone-scenarios'

/**
 * standalone-acceptance proves a release installs and works the way a newcomer meets it: the install
 * script piped from curl into `sh`, a throwaway `$HOME`, no checkout above anything, and neither Bun
 * nor Node on `PATH`. `just standalone-cli-acceptance` builds a release and runs this against it.
 *
 * The release directory is mirrored at GitHub's tag-specific `download/v<version>/` URL and served
 * through `file://`, with a release listing beside it for the unpinned install.
 *
 * Named scenarios retain progress and failure evidence for installation, source recovery, starter
 * journeys, semantic reports, builds, and the dev browser journey. Native targets are not claimed.
 */

/** A PATH with the system tools and nothing a Tao developer's shell would add. */
const SYSTEM_PATH = '/usr/bin:/bin'

/** DEV_START_TIMEOUT_MS bounds how long `tao run` may take to bring Metro up. */
const DEV_START_TIMEOUT_MS = 180_000

/** HOST_INSTALL_NOTICE opens the line an installed Tao prints while it installs its host. */
const HOST_INSTALL_NOTICE = "Installing Tao's Expo host"

/** PROXY_ENV is the network setup a person's own shell would carry, which the host install needs. */
const PROXY_ENV = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy'] as const

/** The release files a GitHub release carries; `release.json` and the notes are not the installer's. */
const INSTALLER_FILES = ['tao-darwin-arm64.gz', 'tao-darwin-arm64.gz.sha256', 'install.sh'] as const

/** The VM harness retrieves this guest log directory before deleting its disposable clone. */
const ACCEPTANCE_LOG_DIR = Platform.runtimeProcess.env['TAO_ACCEPTANCE_LOG_DIR']
let shellStep = 0

try {
  const release = Platform.runtimeProcess.argv[2]
  if (release === undefined) {
    Errors.throwUserInput('Usage: standalone-acceptance.ts <release directory>')
  }
  await accept(FS.resolvePath(release))
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}

async function accept(release: string): Promise<void> {
  const { version } = await FS.readJson<{ version: string }>(FS.resolvePath('release.json', release))
  const installScript = await FS.readText(FS.resolvePath('install.sh', release))
  if (installScript.includes('@TAO_RELEASES@') || installScript.includes('@TAO_VERSION@')) {
    Errors.throwUnexpected('The published install script still contains a release placeholder.')
  }

  const root = await FS.realPath(await FS.mkTmpDir('tao-standalone-acceptance-'))
  try {
    if (ACCEPTANCE_LOG_DIR !== undefined && Platform.runtimeProcess.env['TAO_ACCEPTANCE_AUDIT_FILESYSTEM'] === '1') {
      await FS.writeJson(FS.resolvePath('audit-scope.json', ACCEPTANCE_LOG_DIR), {
        guestHome: Platform.runtimeProcess.env['HOME'],
        guestTemp: await FS.realPath(FS.tmpdir()),
        root,
        vmProfile: Platform.runtimeProcess.env['TAO_ACCEPTANCE_VM_PROFILE'] ?? 'vanilla',
      })
    }
    if (Repo.tryGetRoot(root) !== undefined) {
      Errors.throwHostEnvironment(
        `The acceptance must run outside a checkout, and ${root} is inside one. Point TMPDIR elsewhere.`,
      )
    }
    const releases = FS.resolvePath('releases', root)
    for (const name of INSTALLER_FILES) {
      await FS.copyFile(FS.resolvePath(name, release), FS.resolvePath(`download/v${version}/${name}`, releases))
    }
    const listing = FS.resolvePath('releases.json', root)
    await FS.writeJson(listing, [
      { tag_name: 'studio-v99.0.0', draft: false, prerelease: false },
      { tag_name: `v${version}`, draft: false, prerelease: false },
    ])
    const home = FS.resolvePath('home', root)
    const userBin = FS.resolvePath('.tao/bin', home)
    await FS.mkdir(userBin)
    const environment = newcomerEnvironment(home, userBin, `file://${releases}`, `file://${listing}`)
    const shell = newcomerShell(environment)

    const project = FS.resolvePath('a-tally-counter', home)
    const summary = FS.resolvePath('acceptance-summary.json', ACCEPTANCE_LOG_DIR ?? release)
    HCI.writeLine(`Acceptance summary: ${summary}`)
    await StandaloneScenarios.run([
      {
        name: 'install latest release through curl and sh',
        run: () => shell(home, `curl -fsSL "$TAO_RELEASES/download/v${version}/install.sh" | sh`),
      },
      {
        name: 'replace the installed release with a pinned install',
        run: () =>
          shell(home, `curl -fsSL "$TAO_RELEASES/download/v${version}/install.sh" | TAO_VERSION=${version} sh`),
      },
      {
        name: 'installed version and first-release command surface',
        run: async () => {
          const reported = (await shell(home, 'tao --version')).trim()
          if (reported !== version) {
            Errors.throwUnexpected(`The installed tao reports ${JSON.stringify(reported)}, not ${version}.`)
          }
          if (/^\s+review\b/m.test(await shell(home, 'tao --help'))) {
            Errors.throwUnexpected('The installed tao still offers `tao review`, which the first release leaves out.')
          }
        },
      },
      {
        name: 'installed feedback commands outside a checkout',
        run: async () => {
          const json = await shell(home, 'tao doctor --json')
          const fingerprint = JSON.parse(json) as {
            tao?: { version?: string }
            toolchain?: Array<{ hash?: string; name: string; present: boolean }>
          }
          const resources = fingerprint.toolchain?.find(component => component.name === 'tao-resources')
          const hash = resources?.hash
          if (
            fingerprint.tao?.version !== version || !resources?.present || hash === undefined
            || !/^[0-9a-f]{64}$/.test(hash)
          ) {
            Errors.throwUnexpected('The installed doctor did not report this release and its resource hash.')
          }
          if (json.includes(home)) {
            Errors.throwUnexpected('The installed doctor exposed the visitor home directory.')
          }
          const report = await shell(home, 'tao bug-report')
          if (!report.includes(hash) || !report.includes('template=could-not-build-it.yml')) {
            Errors.throwUnexpected('The installed bug report omitted its fingerprint or feedback route.')
          }
        },
      },
      {
        name: 'bundled stdlib identity, typed sidecars, and native modules',
        run: async () => {
          const resources = FS.resolvePath(`.tao/versions/${version}/resources`, home)
          const stdlib = FS.resolvePath('stdlib', resources)
          const identity = await FS.readJson<{ id: string }>(FS.resolvePath('.tao/store/project.json', stdlib))
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(identity.id)) {
            Errors.throwUnexpected('The installed stdlib has no stable project identity.')
          }
          for (
            const path of [
              'stdlib/Package.tao',
              'stdlib/@tao/text/Text.tao',
              'stdlib/@tao/text/Text.ts',
              'stdlib/@tao/device/haptic/Haptic.tao',
              'stdlib/@tao/device/haptic/Haptic.ts',
              'modules/@tao/runtime/TaoRuntime-src/TR-haptic.ts',
              'stdlib/@tao/device/files/Bindings.tao',
              'stdlib/@tao/device/photos/Bindings.tao',
              'stdlib/.tao-ts/native-bindings/files/Bindings.ts',
              'stdlib/.tao-ts/native-bindings/photos/Bindings.ts',
              'native-bindings-generator/maintained-native-bindings.ts',
              'native-bindings-engine/node_modules/typescript/lib/typescript.js',
            ]
          ) {
            if (!await FS.isFile(FS.resolvePath(path, resources))) {
              Errors.throwUnexpected(`The installed resource bundle omitted ${path}.`)
            }
          }
        },
      },
      {
        name: 'recover maintained native bindings with only installed resources',
        run: async () => {
          const resources = FS.resolvePath(`.tao/versions/${version}/resources`, home)
          const hostModules = FS.resolvePath('host/node_modules', resources)
          if (await FS.exists(hostModules)) {
            Errors.throwUnexpected('Native recovery must run before host dependency installation.')
          }
          const files = ['files', 'photos'].map(capability =>
            FS.resolvePath(`stdlib/.tao-ts/native-bindings/${capability}/Bindings.ts`, resources)
          )
          const previous = await Promise.all(files.map(path => FS.readText(path)))
          await FS.remove(files[0]!)
          await shell(home, 'tao bindings generate --maintained')
          for (const [index, path] of files.entries()) {
            if (await FS.readText(path) !== previous[index]) {
              Errors.throwUnexpected('Installed native regeneration changed the pinned generated implementation.')
            }
          }
          if (await FS.exists(hostModules)) {
            Errors.throwUnexpected('Native declaration recovery unexpectedly installed host dependencies.')
          }
        },
      },
      {
        name: 'create a deterministic starter outside a checkout',
        run: () => shell(home, 'tao create "A tally counter" --provider local --ai none --yes --skip-tests'),
      },
      {
        name: 'newly created app selects native appearance defaults',
        run: async () => {
          const chrome = await FS.readText(FS.resolvePath('Chrome.tao', project))
          const content = await FS.readText(FS.resolvePath('Items/Items.tao', project))
          if (!chrome.includes('use StackNav from @tao/nav') || !content.includes('from @tao/ui')) {
            Errors.throwUnexpected('The installed starter omitted the native navigation or UI default.')
          }
        },
      },
      {
        name: 'project pin, version overrides, missing version, and updates',
        run: () => versionPinWorks(environment, project, version),
      },
      { name: 'check the created project', run: () => shell(project, 'tao check .') },
      {
        name: 'reject malformed source without rewriting it',
        run: () => malformedSourceIsReadOnly(environment, project),
      },
      { name: 'fix and format converge on canonical source', run: () => canonicalSourceRecovers(environment, project) },
      { name: 'machine-readable starter facts and textual coverage', run: () => semanticReports(environment, project) },
      {
        name: 'compile the installed starter',
        run: async () => {
          await shell(project, 'tao compile App.tao')
          const generated = ProjectLocal.cacheResolve('_gen_tao-app/App.tsx', project)
          if (!await FS.isFile(generated)) {
            Errors.throwUnexpected(`tao compile reported success but wrote no ${generated}.`)
          }
        },
      },
      {
        name: 'build compile-only into the project',
        run: async () => {
          await shell(project, 'tao build --web --compile-only')
          const compiled: string[] = []
          for await (const path of FS.walk(ProjectLocal.localResolve('builds', project))) {
            if (path.endsWith('/compiled/web/_gen_tao-app/App.tsx')) {
              compiled.push(path)
            }
          }
          if (compiled.length !== 1) {
            Errors.throwUnexpected('tao build --compile-only reported success but wrote no compiled web App.tsx.')
          }
        },
      },
      {
        name: 'cold web build installs its host and emits a site',
        run: async () => {
          const first = await shell(project, 'TAO_HOST_INSTALL=yes tao build --web')
          if (!first.includes(HOST_INSTALL_NOTICE)) {
            Errors.throwUnexpected('The first web build did not say it was installing the host.')
          }
          const sites: string[] = []
          for await (const path of FS.walk(ProjectLocal.localResolve('builds', project))) {
            if (path.includes('/web/') && path.endsWith('/index.html')) {
              sites.push(path)
            }
          }
          if (sites.length !== 1) {
            Errors.throwUnexpected('tao build --web reported success but wrote no index.html.')
          }
        },
      },
      { name: 'run the starter journeys', run: () => passingJourneys(shell, project) },
      {
        name: 'reject a broken journey, restore it, and pass',
        run: () => failingJourneyRecovers(environment, project),
      },
      {
        name: 'create with journeys and reuse the host in a second project',
        run: async () => {
          await shell(home, 'tao create "A reading list" --provider local --ai none --yes')
          const second = await shell(FS.resolvePath('a-reading-list', home), 'tao build --web')
          if (second.includes(HOST_INSTALL_NOTICE)) {
            Errors.throwUnexpected('A second project installed the host again instead of sharing the first install.')
          }
        },
      },
      ...(Platform.runtimeProcess.env['TAO_ACCEPTANCE_BROWSER_DRIVER'] === undefined ? [] : [{
        name: 'prepare a deterministic browser journey',
        run: () => prepareBrowserClickProject(environment, project),
      }]),
      {
        name: 'run serves web and runs the available browser journey',
        run: () => devLoopServesWeb(environment, project, 'ATallyCounter'),
      },
      {
        name: 'watch refreshes a saved TypeScript bridge',
        run: () => watchRefreshesSavedBridge(environment, project),
      },
    ], summary)
    HCI.logProcessInfo(
      'standalone',
      `Accepted Tao ${version}: installed CLI scenarios passed. Evidence: ${summary}`,
    )
  } finally {
    // The audit snapshots the projects and temporary home after acceptance returns. The VM is
    // disposable, so it owns removal after the second snapshot instead of this process.
    if (Platform.runtimeProcess.env['TAO_ACCEPTANCE_AUDIT_FILESYSTEM'] !== '1') {
      // Dotslash extracts React Native DevTools with read-only directories. Make this test's
      // private copy writable before removing the throwaway home.
      const dotslash = FS.resolvePath('home/.tao/cache/dotslash', root)
      if (await FS.isDirectory(dotslash)) {
        for await (const path of FS.walk(dotslash, { includeDirectories: true, includeHidden: true })) {
          if (await FS.isDirectory(path)) {
            await FS.chmod(path, 0o755)
          }
        }
      }
      await FS.remove(root)
    }
  }
}

/** Exercise the installed watcher and its generated contract after a saved Tao edit. */
async function watchRefreshesSavedBridge(environment: Platform.ProcessEnv, project: string): Promise<void> {
  const taoPath = FS.resolvePath('WatchProbe.tao', project)
  const typescriptPath = FS.resolvePath('WatchProbe.ts', project)
  const contractPath = FS.resolvePath('.tao-ts/WatchProbe.tao.ts', project)
  await FS.writeText(typescriptPath, 'export const Answer = (): number => 42\n')
  let output = ''
  const watch = CLI.start('/bin/sh', {
    args: ['-c', 'exec tao watch .'],
    cwd: project,
    env: environment,
    processPolicy: 'test',
    timeoutMs: 900_000,
    onOutput: (_stream, chunk) => {
      output += String(chunk)
    },
    stdio: 'pipe',
  })
  try {
    await waitForProcessReadiness(
      watch,
      () => [...output.matchAll(/Tao project fresh \(revision \d+\)\./gu)].length >= 1,
      () => output,
      'tao watch revision 1',
      DEV_START_TIMEOUT_MS,
    )
    await FS.writeText(taoPath, 'function Answer() returns number {\n   return Answer() from ./WatchProbe.ts\n}\n')
    await waitForProcessReadiness(
      watch,
      () => [...output.matchAll(/Tao project fresh \(revision \d+\)\./gu)].length >= 2,
      () => output,
      'tao watch revision 2',
      DEV_START_TIMEOUT_MS,
    )
    if (!await FS.isFile(contractPath)) {
      Errors.throwUnexpected(`tao watch reported a refresh but wrote no ${contractPath}.`)
    }
  } finally {
    watch.kill('SIGTERM')
    await watch.waitForClose()
    await FS.remove(taoPath)
    await FS.remove(typescriptPath)
  }
}

/** A syntax rejection must name its source position and leave the author's input intact. */
async function malformedSourceIsReadOnly(environment: Platform.ProcessEnv, project: string): Promise<void> {
  const file = FS.resolvePath('Acceptance.tao', project)
  const source = 'view Broken() {\n   render Text(\n}\n'
  await FS.writeText(file, source)
  try {
    await newcomerShell(environment)(project, 'tao check Acceptance.tao', /Acceptance\.tao:3:1 error:/)
    if (await FS.readText(file) !== source) {
      Errors.throwUnexpected('tao check rewrote malformed input.')
    }
  } finally {
    await FS.remove(file)
  }
}

/** Each in-place command must repair whitespace and then leave its canonical result unchanged. */
async function canonicalSourceRecovers(environment: Platform.ProcessEnv, project: string): Promise<void> {
  const shell = newcomerShell(environment)
  const file = FS.resolvePath('App.tao', project)
  const canonical = await FS.readText(file)
  const noncanonical = canonical.replace(/^ +/gm, ' ')
  if (noncanonical === canonical) {
    Errors.throwUnexpected('The starter has no indentation to exercise formatting recovery.')
  }
  try {
    for (const command of ['fix', 'fmt']) {
      await FS.writeText(file, noncanonical)
      await shell(project, 'tao check App.tao', /Needs fixes/)
      if (await FS.readText(file) !== noncanonical) {
        Errors.throwUnexpected('tao check rewrote noncanonical input.')
      }
      await shell(project, `tao ${command} App.tao`)
      if (await FS.readText(file) !== canonical) {
        Errors.throwUnexpected(`tao ${command} did not restore the starter's canonical source.`)
      }
      await shell(project, `tao ${command} App.tao`)
      if (await FS.readText(file) !== canonical) {
        Errors.throwUnexpected(`tao ${command} changed already canonical source.`)
      }
      await shell(project, 'tao check App.tao')
    }
  } finally {
    await FS.writeText(file, canonical)
  }
}

/** Exercise the installed semantic entrypoints with the starter's real source and checks. */
async function semanticReports(environment: Platform.ProcessEnv, project: string): Promise<void> {
  const shell = newcomerShell(environment)
  const facts = JSON.parse(await shell(project, 'tao facts . App.tao ATallyCounter'))
  if (
    facts.format !== 'tao-semantic-facts-v1' || facts.version !== 1 || facts.app !== 'ATallyCounter'
    || !Array.isArray(facts.facts) || facts.facts.length === 0 || !Array.isArray(facts.diagnostics)
    || facts.diagnostics.some((diagnostic: { severity: string }) => diagnostic.severity === 'error')
  ) {
    Errors.throwUnexpected(`tao facts did not report the created app's semantic envelope: ${JSON.stringify(facts)}`)
  }
  const coverage = JSON.parse(await shell(project, 'tao coverage . App.tao ATallyCounter ItemList'))
  if (
    coverage.format !== 'tao-semantic-coverage-v1' || coverage.version !== 1 || coverage.coverage?.view !== 'ItemList'
    || !Array.isArray(coverage.coverage.shows)
    || !coverage.coverage.shows.some((show: { text: string; checks: string[] }) =>
      show.text === 'No items yet' && show.checks.includes('adds a item, opens it, and renames it')
    )
  ) {
    Errors.throwUnexpected(
      `tao coverage did not connect the starter's empty state to its journey: ${JSON.stringify(coverage)}`,
    )
  }
}

async function passingJourneys(shell: ReturnType<typeof newcomerShell>, project: string): Promise<void> {
  const tested = await shell(project, 'TAO_HOST_INSTALL=yes tao test')
  if (!/Tests:\s+[1-9]\d* passed/.test(tested)) {
    Errors.throwUnexpected(`tao test exited cleanly but reported no passing journeys:\n${tested}`)
  }
}

/** A real generated assertion fails under the installed runner, then passes again after restoration. */
async function failingJourneyRecovers(environment: Platform.ProcessEnv, project: string): Promise<void> {
  const shell = newcomerShell(environment)
  const file = FS.resolvePath('ATallyCounter.test.tao', project)
  const source = await FS.readText(file)
  const expected = 'expect text "No items yet"'
  if (!source.includes(expected)) {
    Errors.throwUnexpected('The starter journey has no empty-state assertion to exercise rejection.')
  }
  await FS.writeText(file, source.replace(expected, 'expect text "Acceptance deliberately missing text"'))
  try {
    await shell(
      project,
      'tao test --output lines',
      /expect text "Acceptance deliberately missing text" expected rendered text but found none\./,
    )
  } finally {
    await FS.writeText(file, source)
  }
  await passingJourneys(shell, project)
}

/** Replace the generated app after its own acceptance steps with a deterministic browser journey. */
async function prepareBrowserClickProject(environment: Platform.ProcessEnv, project: string): Promise<void> {
  const appFile = FS.resolvePath('App.tao', project)
  const otherSources: string[] = []
  for await (
    const path of FS.walk(project, {
      extensions: ['.tao'],
      excludeDirectory: name => name.startsWith('.') || name === 'node_modules',
    })
  ) {
    if (path !== appFile) {
      otherSources.push(path)
    }
  }
  for (const path of otherSources) {
    await FS.remove(path)
  }
  await FS.writeText(
    appFile,
    `use StackNav from @tao/nav
use Button, Col, Text from @tao/ui

app ATallyCounter {
   id "a-tally-counter"
   version "0.1.0"
   name "Browser Click"
   Navigator StackNav {
      Initial CounterView
   }
}

scene CounterView() {
   Title "Browser Click"
   state Count = 0
   render Col() {
      Text("Browser clicks: { Count }")
      Button("Increment") {
         on press -> { set Count += 1 }
      }
   }
}
`,
  )
  const shell = newcomerShell(environment)
  await shell(project, 'tao fix App.tao')
  await shell(project, 'tao check .')
  await shell(project, 'tao build --web')
}

/**
 * versionPinWorks checks the created project pins the release that made it, that `+version` and
 * `TAO_VERSION` both reach that release, that a pinned release which is not installed is named with
 * its install command when there is no terminal to ask, and that `tao check-for-updates` reads the
 * release listing.
 */
async function versionPinWorks(environment: Platform.ProcessEnv, project: string, version: string): Promise<void> {
  const lock = JSON.parse(Text.stripJsonc(await FS.readText(ProjectLocal.storeResolve('lock.jsonc', project))))
  if (lock?.toolchain?.version !== version) {
    Errors.throwUnexpected(`tao create pinned ${JSON.stringify(lock?.toolchain)}, not Tao ${version}.`)
  }
  const shell = newcomerShell(environment)
  for (const script of [`tao +${version} --version`, `TAO_VERSION=${version} tao --version`]) {
    if ((await shell(project, script)).trim() !== version) {
      Errors.throwUnexpected(`\`${script}\` did not run Tao ${version}.`)
    }
  }
  await shell(project, 'tao +9.9.9 --version', /download\/v9\.9\.9\/install\.sh/)
  const updates = await shell(project, 'tao check-for-updates')
  if (!updates.includes(`Tao ${version} is the latest release.`)) {
    Errors.throwUnexpected(`tao check-for-updates did not recognise Tao ${version} as the latest:\n${updates}`)
  }
}

/**
 * devLoopServesWeb starts `tao run` in `project`, waits for Metro to report its port, fetches the
 * web bundle from it, and stops the loop. The bundle must name the app, so a Metro that answers
 * with an error page does not pass.
 */
async function devLoopServesWeb(environment: Platform.ProcessEnv, project: string, appName: string): Promise<void> {
  let output = ''
  const dev = CLI.start('/bin/sh', {
    args: ['-c', 'exec tao run'],
    cwd: project,
    env: environment,
    processPolicy: 'test',
    timeoutMs: 900_000,
    onOutput: (_stream, chunk) => {
      output += String(chunk)
    },
    stdio: 'pipe',
  })
  try {
    let port: string | undefined
    try {
      await waitForProcessReadiness(
        dev,
        () => {
          port = /Waiting on http:\/\/localhost:(\d+)/.exec(output)?.[1]
          return port !== undefined
        },
        () => output,
        'tao run Metro',
        DEV_START_TIMEOUT_MS,
      )
    } catch (cause) {
      // Report the startup verdict before sampling a still-running child. Exited children already
      // carry captured diagnostics, and collecting a dead PID cannot improve their startup stack.
      HCI.writeErrorLine(Errors.formatForUser(cause))
      if (dev.error === undefined && dev.exitCode === null && dev.signalCode === null) {
        try {
          await collectDevStartupDiagnostics(dev.pid)
        } catch (diagnosticError) {
          HCI.writeErrorLine(`Startup diagnostic collection failed: ${Errors.messageOf(diagnosticError)}`)
        }
      }
      throw cause
    }
    const response = await fetch(`http://127.0.0.1:${port}/index.bundle?platform=web&dev=true&minify=false`, {
      signal: AbortSignal.timeout(DEV_START_TIMEOUT_MS),
    } as RequestInit)
    const bundle = await response.text()
    if (response.status !== 200 || !bundle.includes(appName)) {
      Errors.throwUnexpected(`tao run's Metro answered ${response.status} without ${appName} in its web bundle.`)
    }
    const browserDriver = Platform.runtimeProcess.env['TAO_ACCEPTANCE_BROWSER_DRIVER']
    if (browserDriver !== undefined) {
      const click = await CLI.run(browserDriver, {
        args: [
          `http://127.0.0.1:${port}/`,
          FS.resolvePath('App.tao', project),
          ACCEPTANCE_LOG_DIR ?? ProjectLocal.cacheResolve('browser-acceptance', project),
        ],
        cwd: project,
        env: {
          ...environment,
          HOME: Platform.runtimeProcess.env['HOME'],
          TAO_STUDIO_CHROME_PATH: Platform.runtimeProcess.env['TAO_STUDIO_CHROME_PATH'],
        },
        onOutput: (_stream, chunk) => HCI.write(String(chunk)),
        processPolicy: 'test',
        timeoutMs: 420_000,
      })
      if (ACCEPTANCE_LOG_DIR !== undefined) {
        await FS.writeText(FS.resolvePath('browser-click.log', ACCEPTANCE_LOG_DIR), click.stdout + click.stderr)
      }
      if (click.exitCode !== 0) {
        Errors.throwHostEnvironment(
          `The compiled browser click failed (exit ${click.exitCode}):\n${click.stdout}${click.stderr}`,
        )
      }
    }
  } finally {
    dev.kill('SIGTERM')
    await dev.waitForClose()
    if (ACCEPTANCE_LOG_DIR !== undefined) {
      await FS.writeText(FS.resolvePath('dev-loop.log', ACCEPTANCE_LOG_DIR), output)
    }
  }
}

/** Preserve the live startup stack before terminating a failed installed run. */
async function collectDevStartupDiagnostics(pid: number | undefined): Promise<void> {
  if (ACCEPTANCE_LOG_DIR === undefined) {
    return
  }
  const commands = [
    { name: 'dev-start-processes.log', command: '/bin/ps', args: ['-axo', 'pid,ppid,etime,%cpu,command'] },
    ...(pid === undefined
      ? []
      : [{
        name: 'dev-start-sample-command.log',
        command: '/usr/bin/sample',
        args: [String(pid), '5', '-file', FS.resolvePath('dev-start-sample.log', ACCEPTANCE_LOG_DIR)],
      }, { name: 'dev-start-open-files.log', command: '/usr/sbin/lsof', args: ['-p', String(pid)] }]),
    {
      name: 'dev-start-diagnostic-reports.log',
      command: '/bin/sh',
      args: [
        '-c',
        'for report in /Library/Logs/DiagnosticReports/tao_*.diag; do [ -f "$report" ] || continue; printf "\\n%s\\n" "$report"; /bin/cat "$report"; done',
      ],
    },
  ]
  for (const diagnostic of commands) {
    try {
      const result = await CLI.run(diagnostic.command, {
        args: diagnostic.args,
        processPolicy: 'test',
        timeoutMs: 30_000,
      })
      await FS.writeText(FS.resolvePath(diagnostic.name, ACCEPTANCE_LOG_DIR), result.stdout + result.stderr)
    } catch (error) {
      await FS.writeText(FS.resolvePath(diagnostic.name, ACCEPTANCE_LOG_DIR), Errors.formatForUser(error))
    }
  }
}

/**
 * newcomerEnvironment is the environment a person who just installed Tao would have: a fresh login's
 * variables, plus whatever proxy their network needs.
 *
 * The acceptance runs on the host so Metro can use native filesystem events with this throwaway
 * `$HOME`; its PATH contains only the installed Tao command and system tools.
 */
function newcomerEnvironment(
  home: string,
  userBin: string,
  releases: string,
  listing: string,
): Platform.ProcessEnv {
  const proxies = Object.fromEntries(PROXY_ENV.map(name => [name, Platform.runtimeProcess.env[name]]))
  return {
    ...proxies,
    HOME: home,
    PATH: `${userBin}:${SYSTEM_PATH}`,
    TAO_RELEASES: releases,
    TAO_RELEASE_INDEX_URL: listing,
    TMPDIR: Platform.runtimeProcess.env['TMPDIR'],
  }
}

/**
 * newcomerShell runs commands through `sh` in the newcomer's environment. It returns their output
 * and fails on a non-zero exit.
 */
function newcomerShell(environment: Platform.ProcessEnv) {
  return async (cwd: string, script: string, expectedDiagnostic?: RegExp): Promise<string> => {
    const startedAt = Date.now()
    const result = await CLI.run('/bin/sh', {
      args: ['-c', script],
      cwd,
      env: environment,
      processPolicy: 'test',
      timeoutMs: 600_000,
    })
    if (ACCEPTANCE_LOG_DIR !== undefined) {
      const name = `step-${String(++shellStep).padStart(2, '0')}.log`
      await FS.writeText(
        FS.resolvePath(name, ACCEPTANCE_LOG_DIR),
        `cwd: ${cwd}\ncommand: ${script}\nexit: ${result.exitCode}\nms: ${
          Date.now() - startedAt
        }\n\n${result.stdout}${result.stderr}`,
      )
    }
    return StandaloneScenarios.commandOutput(script, result, expectedDiagnostic)
  }
}

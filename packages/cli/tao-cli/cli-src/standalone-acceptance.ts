import { CLI, Errors, FS, HCI, Platform, Repo, Text, Time } from '@shared'
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

/** DEV_START_TIMEOUT_MS bounds how long `tao dev` may take to bring Metro up. */
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
        name: 'create a deterministic starter outside a checkout',
        run: () => shell(home, 'tao create "A tally counter" --ai none --yes --skip-tests'),
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
          const installed = FS.resolvePath(`.tao/versions/${version}`, home)
          const generated = FS.resolvePath('resources/host/_gen_tao-app/App.tsx', installed)
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
          for await (const path of FS.walk(FS.resolvePath('.tao/builds', project))) {
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
          for await (const path of FS.walk(FS.resolvePath('.tao/builds', project))) {
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
          await shell(home, 'tao create "A reading list" --ai none --yes')
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
        name: 'dev serves web and runs the available browser journey',
        run: () => devLoopServesWeb(environment, project, 'ATallyCounter'),
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

project {
   id "a-tally-counter"
   name "Browser Click"
   version "0.1.0"
   app ATallyCounter
   remote none
}

app ATallyCounter {
   Name "Browser Click"
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
  const lock = JSON.parse(Text.stripJsonc(await FS.readText(FS.resolvePath('.tao-project/lock.jsonc', project))))
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
 * devLoopServesWeb starts `tao dev` in `project`, waits for Metro to report its port, fetches the
 * web bundle from it, and stops the loop. The bundle must name the app, so a Metro that answers
 * with an error page does not pass.
 */
async function devLoopServesWeb(environment: Platform.ProcessEnv, project: string, appName: string): Promise<void> {
  let output = ''
  const dev = CLI.start('/bin/sh', {
    args: ['-c', 'exec tao dev'],
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
    const deadline = Date.now() + DEV_START_TIMEOUT_MS
    let port: string | undefined
    while (port === undefined) {
      port = /Waiting on http:\/\/localhost:(\d+)/.exec(output)?.[1]
      if (port === undefined && (dev.exitCode !== null || Date.now() > deadline)) {
        Errors.throwUnexpected(`tao dev did not start Metro:\n${output}`)
      }
      await Time.sleep(250)
    }
    const response = await fetch(`http://127.0.0.1:${port}/index.bundle?platform=web&dev=true&minify=false`, {
      signal: AbortSignal.timeout(DEV_START_TIMEOUT_MS),
    } as RequestInit)
    const bundle = await response.text()
    if (response.status !== 200 || !bundle.includes(appName)) {
      Errors.throwUnexpected(`tao dev's Metro answered ${response.status} without ${appName} in its web bundle.`)
    }
    const browserDriver = Platform.runtimeProcess.env['TAO_ACCEPTANCE_BROWSER_DRIVER']
    if (browserDriver !== undefined) {
      const click = await CLI.run(browserDriver, {
        args: [
          `http://127.0.0.1:${port}/`,
          FS.resolvePath('App.tao', project),
          ACCEPTANCE_LOG_DIR ?? FS.resolvePath('.tao/browser-acceptance', project),
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

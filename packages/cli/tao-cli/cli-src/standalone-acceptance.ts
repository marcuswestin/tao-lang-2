import { CLI, Errors, FS, HCI, Platform, Repo, Time } from '@shared'

/**
 * standalone-acceptance proves a release installs and works the way a newcomer meets it: the install
 * script piped from curl into `sh`, a throwaway `$HOME`, no checkout above anything, and neither Bun
 * nor Node on `PATH`. `just standalone-cli-acceptance` builds a release and runs this against it.
 *
 * The release directory is mirrored at GitHub's tag-specific `download/v<version>/` URL and served
 * through `file://`, with a release listing beside it for the unpinned install.
 *
 * Each slice of the standalone plan adds its step here as it lands. Today that is `tao create` with
 * its tests, then `tao check`, `tao compile`, `tao test`, `tao build`, and `tao dev` serving the web
 * target on what it created; the native targets are not yet claimed.
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
    const userBin = FS.resolvePath('.local/bin', home)
    await FS.mkdir(userBin)
    const environment = await newcomerEnvironment(root, home, userBin, `file://${releases}`, `file://${listing}`)
    const shell = newcomerShell(environment)

    await shell(home, `curl -fsSL "$TAO_RELEASES/download/v${version}/install.sh" | sh`)
    // Again, pinned: no index needed, and replacing an installed version in place.
    await shell(home, `curl -fsSL "$TAO_RELEASES/download/v${version}/install.sh" | TAO_VERSION=${version} sh`)

    const reported = (await shell(home, 'tao --version')).trim()
    if (reported !== version) {
      Errors.throwUnexpected(`The installed tao reports ${JSON.stringify(reported)}, not ${version}.`)
    }
    await shell(home, 'tao create "A tally counter" --ai none --yes --skip-tests')
    const project = FS.resolvePath('a-tally-counter', home)
    await shell(project, 'tao check .')
    await shell(project, 'tao compile App.tao')

    const installed = FS.resolvePath(`.local/share/tao/versions/${version}`, home)
    const generated = FS.resolvePath('resources/host/_gen_tao-app/App.tsx', installed)
    if (!await FS.isFile(generated)) {
      Errors.throwUnexpected(`tao compile reported success but wrote no ${generated}.`)
    }
    // The decided replacement for `tao compile`, which writes into the project's own `.tao/builds/`
    // rather than into the installed version.
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
    // A full web build installs the host's packages first: a cold download into this throwaway
    // home, approved ahead of time because there is no terminal to ask.
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
    // `tao test` downloads the release's Node once and runs the project's journeys under it.
    const tested = await shell(project, 'TAO_HOST_INSTALL=yes tao test')
    if (!/Tests:\s+[1-9]\d* passed/.test(tested)) {
      Errors.throwUnexpected(`tao test exited cleanly but reported no passing journeys:\n${tested}`)
    }
    // A second project is created with its tests run, as a newcomer's first `tao create` is, and
    // builds against the same host install rather than resolving its own.
    await shell(home, 'tao create "A reading list" --ai none --yes')
    const second = await shell(FS.resolvePath('a-reading-list', home), 'tao build --web')
    if (second.includes(HOST_INSTALL_NOTICE)) {
      Errors.throwUnexpected('A second project installed the host again instead of sharing the first install.')
    }
    await devLoopServesWeb(environment, project, 'ATallyCounter')
    HCI.logProcessInfo(
      'standalone',
      `Accepted Tao ${version}: installed through curl | sh, then create with its tests, check, compile,`
        + ' test, build --compile-only, build --web in two projects sharing one host install, and tao dev'
        + ' serving web, outside a checkout.',
    )
  } finally {
    await FS.remove(root)
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
    const response = await fetch(`http://127.0.0.1:${port}/index.bundle?platform=web&dev=true&minify=false`)
    const bundle = await response.text()
    if (response.status !== 200 || !bundle.includes(appName)) {
      Errors.throwUnexpected(`tao dev's Metro answered ${response.status} without ${appName} in its web bundle.`)
    }
  } finally {
    dev.kill('SIGTERM')
    await dev.waitForClose()
  }
}

/**
 * newcomerEnvironment is the environment a person who just installed Tao would have: a fresh login's
 * variables, plus whatever proxy their network needs.
 *
 * Inside an agent sandbox, which refuses FSEvents, Metro can watch files only through Watchman, and
 * this throwaway `$HOME` has no Watchman server of its own. `TAO_ACCEPTANCE_WATCHMAN` names a
 * `watchman` binary for that case: only it joins `PATH`, and it talks to the real server's socket.
 * A person's terminal needs neither.
 */
async function newcomerEnvironment(
  root: string,
  home: string,
  userBin: string,
  releases: string,
  listing: string,
): Promise<Platform.ProcessEnv> {
  const proxies = Object.fromEntries(PROXY_ENV.map(name => [name, Platform.runtimeProcess.env[name]]))
  const watchman = Platform.runtimeProcess.env['TAO_ACCEPTANCE_WATCHMAN']
  let path = `${userBin}:${SYSTEM_PATH}`
  let watchmanSocket: Record<string, string> = {}
  if (watchman !== undefined && watchman.length > 0) {
    const watchmanBin = FS.resolvePath('watchman-bin', root)
    await FS.symlink(watchman, FS.resolvePath('watchman', watchmanBin))
    path = `${watchmanBin}:${path}`
    const sockname = await CLI.mustRun(watchman, { args: ['get-sockname'] })
    watchmanSocket = { WATCHMAN_SOCK: (JSON.parse(sockname.stdout) as { sockname: string }).sockname }
  }
  return {
    ...proxies,
    ...watchmanSocket,
    HOME: home,
    PATH: path,
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
  return async (cwd: string, script: string): Promise<string> => {
    const result = await CLI.run('/bin/sh', {
      args: ['-c', script],
      cwd,
      env: environment,
    })
    if (result.exitCode !== 0) {
      Errors.throwUnexpected(`\`${script}\` failed (exit ${result.exitCode}):\n${result.stdout}${result.stderr}`)
    }
    return result.stdout
  }
}

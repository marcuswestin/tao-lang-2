import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

/**
 * standalone-acceptance proves a release installs and works the way a newcomer meets it: the install
 * script piped from curl into `sh`, a throwaway `$HOME`, no checkout above anything, and neither Bun
 * nor Node on `PATH`. `just standalone-cli-acceptance` builds a release and runs this against it.
 *
 * The release directory is mirrored in GitHub's two URL shapes — `latest/download/` and
 * `download/v<version>/` — and served through `file://`, so the published install script runs
 * unchanged apart from where `TAO_RELEASES` points it.
 *
 * Each slice of the standalone plan adds its step here as it lands. Today that is `tao create`, and
 * `tao check` and `tao compile` on what it created, so `tao dev` and `tao test` are not yet claimed.
 */

/** A PATH with the system tools and nothing a Tao developer's shell would add. */
const SYSTEM_PATH = '/usr/bin:/bin'

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
  if (installScript.includes('@TAO_RELEASES@')) {
    Errors.throwUnexpected('The published install script still names no releases URL.')
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
      await FS.copyFile(FS.resolvePath(name, release), FS.resolvePath(`latest/download/${name}`, releases))
      await FS.copyFile(FS.resolvePath(name, release), FS.resolvePath(`download/v${version}/${name}`, releases))
    }
    const home = FS.resolvePath('home', root)
    const userBin = FS.resolvePath('.local/bin', home)
    await FS.mkdir(userBin)
    const shell = newcomerShell(home, `${userBin}:${SYSTEM_PATH}`, `file://${releases}`)

    await shell(home, 'curl -fsSL "$TAO_RELEASES/latest/download/install.sh" | sh')
    // Again, pinned: the other URL shape, and replacing an installed version in place.
    await shell(home, `curl -fsSL "$TAO_RELEASES/latest/download/install.sh" | TAO_VERSION=${version} sh`)

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
    HCI.logProcessInfo(
      'standalone',
      `Accepted Tao ${version}: installed through curl | sh, then create, check, and compile outside a checkout.`,
    )
  } finally {
    await FS.remove(root)
  }
}

/**
 * newcomerShell runs commands the way a person who just installed Tao would: through `sh`, with only
 * the environment a fresh login has. It returns their output and fails on a non-zero exit.
 */
function newcomerShell(home: string, path: string, releases: string) {
  return async (cwd: string, script: string): Promise<string> => {
    const result = await CLI.run('/bin/sh', {
      args: ['-c', script],
      cwd,
      env: { HOME: home, PATH: path, TAO_RELEASES: releases, TMPDIR: Platform.runtimeProcess.env['TMPDIR'] },
    })
    if (result.exitCode !== 0) {
      Errors.throwUnexpected(`\`${script}\` failed (exit ${result.exitCode}):\n${result.stdout}${result.stderr}`)
    }
    return result.stdout
  }
}

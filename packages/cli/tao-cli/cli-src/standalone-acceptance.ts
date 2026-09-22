import { CLI, Errors, FS, HCI, Platform, Repo } from '@shared'

/**
 * standalone-acceptance proves a built Tao binary works where a newcomer will run it: copied into a
 * directory outside any checkout, with neither Bun nor Node on `PATH`. `just
 * standalone-cli-acceptance` builds the binary and runs this against it.
 *
 * Each slice of the standalone plan adds its step here as it lands. Today that is what slice 2
 * promised — `tao create`, and `tao check` and `tao compile` on what it created — so a later
 * `tao dev` or `tao test` is not yet claimed by a green run.
 */

/** A PATH with the system tools and nothing a Tao developer's shell would add. */
const BARE_PATH = '/usr/bin:/bin'

try {
  await accept(FS.resolvePath(Platform.runtimeProcess.argv[2] ?? '.artifacts/build/tao'))
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}

async function accept(binary: string): Promise<void> {
  const root = await FS.realPath(await FS.mkTmpDir('tao-standalone-acceptance-'))
  try {
    if (Repo.tryGetRoot(root) !== undefined) {
      Errors.throwHostEnvironment(
        `The acceptance must run outside a checkout, and ${root} is inside one. Point TMPDIR elsewhere.`,
      )
    }
    const installed = FS.resolvePath('bin/tao', root)
    await FS.copyFile(binary, installed)
    await FS.chmod(installed, 0o755)

    await run(installed, root, ['create', 'A tally counter', '--ai', 'none', '--yes', '--skip-tests'])
    const project = FS.resolvePath('a-tally-counter', root)
    await run(installed, project, ['check', '.'])
    await run(installed, project, ['compile', 'App.tao'])

    const generated = FS.resolvePath('bin/resources/host/_gen_tao-app/App.tsx', root)
    if (!await FS.isFile(generated)) {
      Errors.throwUnexpected(`tao compile reported success but wrote no ${generated}.`)
    }
    HCI.logProcessInfo('standalone', `Accepted ${binary}: create, check, and compile outside a checkout.`)
  } finally {
    await FS.remove(root)
  }
}

async function run(binary: string, cwd: string, args: readonly string[]): Promise<void> {
  const result = await CLI.run(binary, {
    args,
    cwd,
    env: {
      HOME: Platform.runtimeProcess.env['HOME'],
      PATH: BARE_PATH,
      TMPDIR: Platform.runtimeProcess.env['TMPDIR'],
    },
  })
  if (result.exitCode !== 0) {
    Errors.throwUnexpected(
      `tao ${args[0]} failed outside a checkout (exit ${result.exitCode}):\n${result.stdout}${result.stderr}`,
    )
  }
}

#!/usr/bin/env bun
import tab from '@bomb.sh/tab/commander'
import { Command } from '@commander-js/extra-typings'
import { Diagnostic, Errors, FS, HCI, Platform } from '@shared'
import type { Command as BaseCommand } from 'commander'
import * as DiagnosticReport from './diagnostic-report'
import type { InPlace } from './in-place-files'
import { TaoVersion } from './tao-version'

/**
 * TAO_STANDALONE is defined as `true` when `standalone-build.ts` compiles the distributable binary,
 * and is never declared anywhere else; from source it does not exist, so it is read through
 * `typeof`. It is read where it matters rather than through a module, so the bundler can drop what
 * a standalone binary leaves out.
 */
declare const TAO_STANDALONE: true | undefined

type InPlaceLabels = {
  /** changed labels per-file and summary output, e.g. `formatted`. */
  changed: string
  /** changedLine prefixes per-file success lines, e.g. `Formatted`. */
  changedLine: string
  /** failedVerb names the operation in failure lines, e.g. `format`. */
  failedVerb: string
  /** failOnChanged makes changed files a command failure for check-style commands. */
  failOnChanged?: boolean
}

// Bun sets import.meta.main only for directly executed modules; tests import this file without
// running the CLI. It must be read here, not passed along as `import.meta`: a compiled binary shares
// one runtime `import.meta` among every module in its bundle, so only a direct read is rewritten to
// this module's own answer, and the standalone entry that imports this file would run it twice.
if (import.meta.main) {
  await runTaoCli()
}

/** runTaoCli runs the Tao CLI for the provided argv. */
export async function runTaoCli(argv = Platform.runtimeProcess.argv): Promise<void> {
  await createCommands().parseAsync(argv, { from: 'node' })
}

function createCommands(): Command {
  const commands = new Command()
    .name('tao')
    .description('Tao language CLI.')
    .version(TaoVersion.current(), '-v, --version', 'Print the Tao release this is, or `development` from source.')

  commands
    .command('doctor')
    .option('--json', 'Print the environment fingerprint as JSON.')
    .option('--fingerprint', 'Print only the pasteable environment fingerprint.')
    .description('Show a privacy-filtered environment fingerprint for a feedback report.')
    .action(async (options: { fingerprint?: boolean; json?: boolean }) => {
      const { runVisitorDoctor } = await import('./feedback-command')
      await runVisitorDoctor(options)
    })

  commands
    .command('bug-report')
    .description('Prepare a feedback report with links and a pasteable environment fingerprint.')
    .action(async () => {
      const { runBugReport } = await import('./feedback-command')
      await runBugReport()
    })

  commands
    .command('bridge')
    .argument('<package>', 'Installed package whose public API should be imported.')
    .requiredOption('--source <source>', 'Source adapter: expo or react-native.')
    .option('--export <name>', 'Import one public object, such as React Native Vibration.')
    .option('--exclude <names...>', 'Explicitly omit named public exports and record them in the generated catalog.')
    .option('--from <directory>', 'Resolve installed declarations from this directory.', '.')
    .requiredOption(
      '--out <directory>',
      'Regenerate bindings in a dedicated generated directory; its contents are disposable.',
    )
    .description('Generate experimental Tao bindings for supported native API actions.')
    .action(async (packageName, options) => {
      try {
        const { generateNativeBindingFiles } = await import('@native-bindings')
        const files = await generateNativeBindingFiles(packageName, options)
        HCI.writeSuccess(`Generated native bindings in ${FS.displayPath(FS.dirname(files[0]!))}\n`)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.setExitCode(1)
      }
    })

  commands
    .command('create')
    .argument('<description>', 'What the app is, in a sentence. URLs and image paths in it are read.')
    .option('--id <id>', 'Checked-in project id and directory name. Suggested from the name when omitted.')
    .option('--yes', 'Accept the suggested id, the plan, and the first available AI lane without asking.')
    .option('--ai <lane>', 'How to shape the plan: auto, claude, codex, ollama, apple, or none.', 'auto')
    .option('--skip-tests', "Skip running the new project's tests after creating it.")
    .description('Create a new Tao project from a description.')
    .action(async (description: string, options: { ai: string; id?: string; skipTests?: boolean; yes?: boolean }) => {
      try {
        const { createAiOptions, runCreate } = await import('./create/create-command')
        const ai = createAiOptions.find(candidate => candidate === options.ai)
        if (ai === undefined) {
          Errors.throwUserInput(`--ai must be one of ${createAiOptions.join(', ')}, not '${options.ai}'.`)
        }
        await runCreate(description, {
          ai,
          ...(options.id === undefined ? {} : { id: options.id }),
          ...(options.skipTests === true ? { runTests: false } : {}),
          ...(options.yes === true ? { yes: true } : {}),
        })
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('project')
    .description('Manage checked-in Tao project metadata.')
    .command('id')
    .argument('<id>', 'Opaque project id to persist.')
    .argument('[path]', 'Project .tao file or directory to search.', '.')
    .option('--replace', 'Replace an existing id when making an independent project.')
    .description('Add or deliberately replace a project id.')
    .action(async (id: string, path: string, options: { replace?: boolean }) => {
      try {
        const { setProjectId } = await import('./project-command')
        const projectPath = await setProjectId(id, path, options)
        HCI.writeSuccess(`Project id '${id}' in ${FS.displayPath(projectPath)}\n`)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  const secrets = commands
    .command('secrets')
    .description('Manage age-encrypted secrets committed in a Tao project.')

  secrets
    .command('identity')
    .description('Create or show this Mac’s public secrets recipient.')
    .action(async () =>
      await runSecretAction(async () => {
        const { projectSecretsIdentity } = await import('./project-secrets-command')
        HCI.writeLine(await projectSecretsIdentity())
      })
    )

  secrets
    .command('init')
    .argument('[path]', 'Project file or directory to search.', '.')
    .description('Create a committed encrypted store for the nearest Tao project.')
    .action(async (path: string) =>
      await runSecretAction(async () => {
        const { initProjectSecrets } = await import('./project-secrets-command')
        HCI.writeSuccess(`Created ${FS.displayPath(await initProjectSecrets(path))}. Commit this file.\n`)
      })
    )

  secrets
    .command('grant')
    .argument('<recipient>', 'Public recipient from another developer’s `tao secrets identity`.')
    .argument('[path]', 'Project file or directory to search.', '.')
    .description('Grant an enrolled collaborator access to every project secret.')
    .action(async (recipient: string, path: string) =>
      await runSecretAction(async () => {
        const { grantProjectSecrets } = await import('./project-secrets-command')
        const granted = await grantProjectSecrets(recipient, path)
        HCI.writeLine(granted ? 'Recipient granted. Commit the updated secrets file.' : 'Recipient already has access.')
      })
    )

  secrets
    .command('set')
    .argument('<name>', 'Environment-style secret name, such as INSTANT_APP_ADMIN_TOKEN.')
    .argument('[path]', 'Project file or directory to search.', '.')
    .description('Enter a hidden value and encrypt it into the project store.')
    .action(async (name: string, path: string) =>
      await runSecretAction(async () => {
        const { setProjectSecret } = await import('./project-secrets-command')
        const result = await setProjectSecret(name, path)
        HCI.writeSuccess(
          `${result.replaced ? 'Replaced' : 'Added'} ${name} in ${FS.displayPath(result.path)}. Commit the file.\n`,
        )
      })
    )

  secrets
    .command('get')
    .argument('<name>', 'Name of the value to decrypt and write to stdout.')
    .argument('[path]', 'Project file or directory to search.', '.')
    .description('Decrypt one value and write its exact bytes to stdout.')
    .action(async (name: string, path: string) =>
      await runSecretAction(async () => {
        const { readProjectSecret } = await import('./project-secrets-command')
        HCI.write(await readProjectSecret(name, path))
      })
    )

  secrets
    .command('list')
    .argument('[path]', 'Project file or directory to search.', '.')
    .description('List secret names without decrypting values.')
    .action(async (path: string) =>
      await runSecretAction(async () => {
        const { listProjectSecrets } = await import('./project-secrets-command')
        const entries = await listProjectSecrets(path)
        for (const name of Object.keys(entries).sort()) {
          HCI.writeLine(name)
        }
      })
    )

  secrets
    .command('remove')
    .argument('<name>', 'Name of the value to remove from the current store.')
    .argument('[path]', 'Project file or directory to search.', '.')
    .description('Remove current ciphertext; Git history and provider revocation remain separate.')
    .action(async (name: string, path: string) =>
      await runSecretAction(async () => {
        const { removeProjectSecret } = await import('./project-secrets-command')
        HCI.writeSuccess(`Removed ${name} from ${FS.displayPath(await removeProjectSecret(name, path))}.\n`)
      })
    )

  commands
    .command('dev')
    .argument('[path]', 'Tao file or directory whose runnable apps should be discovered.', '.')
    .option('--app <name>', 'Select a uniquely named app without prompting.')
    .option(
      '--device <name-or-id>',
      'Open a physical device by name, identifier, or Android serial after Metro starts.',
    )
    .option('--ios', 'Open an iOS simulator after Metro starts.')
    .option('--android', 'Open Android after Metro starts.')
    .option('--web', 'Open the web app after Metro starts.')
    .option('--desktop', 'Open the Tao desktop app after Metro starts.')
    .description('Start Metro for a Tao app without opening a target unless requested.')
    .action(
      async (
        path: string,
        options: { android?: boolean; app?: string; desktop?: boolean; device?: string; ios?: boolean; web?: boolean },
      ) => {
        try {
          // Command implementations load lazily so completion and help paths stay fast.
          const { runTaoDev } = await import('./dev-command')
          const startupTargets = (['ios', 'android', 'web', 'desktop'] as const).filter(target =>
            options[target] === true
          )
          Platform.runtimeProcess.setExitCode(
            await runTaoDev(path, { appName: options.app, device: options.device, startupTargets }),
          )
        } catch (error) {
          HCI.writeErrorLine(Errors.formatForUser(error))
          Platform.runtimeProcess.setExitCode(1)
        }
      },
    )

  commands
    .command('build')
    .argument('[path]', 'Tao project file or directory to build.', '.')
    .option('--app <name>', 'Select a named app.')
    .option('--web', 'Export a static web artifact.')
    .option('--desktop', 'Build a locally runnable macOS app.')
    .option('--visionos', 'Export an experimental visionOS Xcode project with bundled web UI.')
    .option('--watchos', 'Export an experimental native SwiftUI watchOS Xcode project.')
    .option('--agents', 'Build a background app service and bundled client executable (defaults to desktop).')
    .option('--output <directory>', 'Retain builds in this directory instead of the project’s .tao/builds.')
    .option('--ios', 'Show the status of local iOS builds.')
    .option('--android', 'Show the status of local Android builds.')
    .option('--compile-only', 'Retain generated source without exporting or packaging.')
    .description('Build fresh, retained local artifacts for selected targets.')
    .action(
      async (
        path: string,
        options: {
          app?: string
          agents?: boolean
          output?: string
          web?: boolean
          desktop?: boolean
          visionos?: boolean
          watchos?: boolean
          ios?: boolean
          android?: boolean
          compileOnly?: boolean
        },
      ) => {
        try {
          const { runTaoBuild } = await import('./build-command')
          const targets = (['web', 'desktop', 'ios', 'android', 'visionos', 'watchos'] as const).filter(target =>
            options[target] === true
          )
          if (options.agents && targets.length === 0) {
            targets.push('desktop')
          }
          Platform.runtimeProcess.setExitCode(
            await runTaoBuild(path, {
              appName: options.app,
              agents: options.agents,
              output: options.output,
              compileOnly: options.compileOnly,
              targets,
            }),
          )
        } catch (error) {
          HCI.writeErrorLine(Errors.formatForUser(error))
          Platform.runtimeProcess.setExitCode(1)
        }
      },
    )

  const agents = commands.command('agents').description('Control a packaged app background service.')
  for (const action of ['start', 'ping', 'stop'] as const) {
    agents.command(action)
      .requiredOption('--app <bundle>', 'Path to the packaged macOS .app bundle.')
      .description(`${action[0]!.toUpperCase()}${action.slice(1)} the app background service.`)
      .action(async (options: { app: string }) => {
        const { runAppAgentCommand } = await import('./agents-command')
        const result = await runAppAgentCommand(action, options.app)
        HCI.writeLine(JSON.stringify(result))
        if (!result.ok) {
          HCI.writeErrorLine(result.error.message)
          Platform.runtimeProcess.setExitCode(1)
        }
      })
  }
  agents.command('commands')
    .requiredOption('--app <bundle>', 'Path to the packaged macOS .app bundle.')
    .option('--json', 'Print the machine-readable JSON response.')
    .description('List the app’s exposed commands.')
    .action(async (options: { app: string; json?: boolean }) => {
      const { runAppAgentCommand } = await import('./agents-command')
      const { printAgentCommands } = await import('./agent-command-output')
      printAgentCommands(await runAppAgentCommand('commands', options.app), options.json)
    })
  agents.command('run')
    .argument('<command-id>', 'Canonical command id returned by agents commands.')
    .requiredOption('--app <bundle>', 'Path to the packaged macOS .app bundle.')
    .requiredOption('--args <json>', 'Command arguments as a JSON value.')
    .description('Run one app command; a lost response is never retried automatically.')
    .action(async (commandId: string, options: { app: string; args: string }) => {
      let args: unknown
      try {
        args = JSON.parse(options.args)
      } catch {
        const message = '--args must contain valid JSON.'
        HCI.writeLine(JSON.stringify({ ok: false, error: { code: 'invalid_params', message } }))
        HCI.writeErrorLine(message)
        Platform.runtimeProcess.setExitCode(1)
        return
      }
      const { runAppAgentCommand } = await import('./agents-command')
      const result = await runAppAgentCommand('run', options.app, { commandId, args })
      HCI.writeLine(JSON.stringify(result))
      if (!result.ok) {
        HCI.writeErrorLine(result.error.message)
        Platform.runtimeProcess.setExitCode(1)
      }
    })

  commands
    .command('instantdb')
    .description('Prepare the InstantDB app a Tao app syncs with.')
    .command('push')
    .argument('[path]', 'Tao file or directory whose app should be pushed.', '.')
    .option('--app <name>', 'Select a named app.')
    .option('--dry-run', 'Generate and plan, print what would change, and apply nothing.')
    .option(
      '--force',
      'Apply a plan that is not purely additive; attributes the Tao schema does not declare stay on the server.',
    )
    .description(
      "Push the app's generated InstantDB schema (additive changes only, unless forced) and permission rules."
        + ' Reads INSTANT_APP_ADMIN_TOKEN from the environment or project secrets, or asks at a terminal.',
    )
    .action(async (path: string, options: { app?: string; dryRun?: boolean; force?: boolean }) => {
      try {
        const { runInstantDBPush } = await import('./instantdb-push-command')
        await runInstantDBPush(path, { appName: options.app, dryRun: options.dryRun, force: options.force })
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.setExitCode(1)
      }
    })

  commands
    .command('clean')
    .argument('[path]', 'Tao project file or directory whose retained local builds should be listed.', '.')
    .description('Interactively select retained local builds to remove.')
    .action(async (path: string) => {
      try {
        const { runTaoClean } = await import('./clean-command')
        await runTaoClean(path)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.setExitCode(1)
      }
    })

  commands
    .command('check-for-updates')
    .description('Say whether a newer Tao release is published, and how to install it.')
    .action(async () => {
      try {
        const { runCheckForUpdates } = await import('./check-for-updates')
        await runCheckForUpdates()
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.setExitCode(1)
      }
    })

  // The standalone binary leaves `tao review` out, because it reaches the whole Studio graph, which
  // the first release does not ship (`R12`). Its build defines this global, and the bundler then drops
  // the branch and the import inside it.
  if (typeof TAO_STANDALONE === 'undefined') {
    commands
      .command('review')
      .argument('[path]', 'Tao project directory to capture in Studio.', '.')
      .option('--app <name>', 'Select a named app within the project.')
      .option('--against <review>', 'Compare with an earlier review.json manifest.')
      .option('--output <directory>', 'Write the immutable review artifact to this new directory.')
      .description('Capture every Studio scenario as a portable web visual review.')
      .action(async (path: string, options: { against?: string; app?: string; output?: string }) => {
        try {
          const { runStudioReview } = await import('tao-studio-tooling/studio-review')
          const result = await runStudioReview(path, {
            against: options.against,
            appName: options.app,
            artifactRoot: options.output,
          })
          const counts = Object.entries(result.statusCounts)
            .filter(([, count]) => count > 0)
            .map(([status, count]) => `${count} ${status}`)
            .join(', ')
          HCI.writeSuccess(`Captured Tao visual review: ${FS.displayPath(result.reportPath)} (${counts})\n`)
        } catch (error) {
          HCI.writeErrorLine(Errors.formatForUser(error))
          Platform.runtimeProcess.setExitCode(1)
        }
      })

    // `_preview` holds commands under development: unlisted in help and free to change until one
    // graduates to a released name.
    const preview = commands
      .command('_preview', { hidden: true })
      .description('Unreleased commands under development; their interface may change.')
    // Repeatable; `list` also splits commas, which no app, device, or appearance name contains.
    const repeated = (value: string, previous: string[] = []): string[] => [...previous, value]
    const list = (value: string, previous: string[] = []): string[] => [
      ...previous,
      ...value.split(',').map(item => item.trim()).filter(Boolean),
    ]
    preview
      .command('qa')
      .argument('[path]', 'Tao project directory to capture in Studio.', '.')
      .option('--screenshot', "Capture the project's scenarios across the device and appearance matrix.")
      .option(
        '--dest <directory>',
        'Screenshot store to append this run to, as runs/<UTC second>Z-<milliseconds>-<UUID>/.',
      )
      .option('--app <names>', 'Capture only these apps (default: every app in the project).', list)
      .option(
        '--scenario <selector>',
        'Capture only matching scenarios, as [<file>.tao:]<subject or group>[/<group or entry>[/<entry>]]; repeatable.',
        repeated,
      )
      .option('--device <names>', 'Devices: phone, tablet, laptop (default: all).', list)
      .option('--appearance <names>', 'Appearances: light, dark (default: both).', list)
      .option('--note <text>', 'Why this capture was taken; shown in the timeline.')
      .option('--studio', "Also capture Studio's own layouts, at laptop size, with this project open.")
      .option('--timeline', "Only regenerate the store's index.html from the runs it already holds.")
      .description('Capture QA evidence for a Tao project.')
      .action(async (
        path: string,
        options: {
          app?: string[]
          appearance?: string[]
          dest?: string
          device?: string[]
          note?: string
          scenario?: string[]
          screenshot?: boolean
          studio?: boolean
          timeline?: boolean
        },
      ) => {
        try {
          if (options.dest === undefined || (options.screenshot === true) === (options.timeline === true)) {
            Errors.throwUserInput(
              'Choose what to do and where: tao _preview qa --screenshot --dest <directory>, or --timeline --dest <directory>.',
            )
          }
          const { runQaScreenshots, writeQaTimeline } = await import('tao-studio-tooling/qa-screenshots')
          if (options.timeline === true) {
            HCI.writeSuccess(`Timeline: ${FS.displayPath(await writeQaTimeline(options.dest))}\n`)
            return
          }
          const result = await runQaScreenshots(path, {
            ...(options.app === undefined ? {} : { apps: options.app }),
            ...(options.appearance === undefined ? {} : { appearances: options.appearance }),
            dest: options.dest,
            ...(options.device === undefined ? {} : { devices: options.device }),
            ...(options.note === undefined ? {} : { note: options.note }),
            ...(options.scenario === undefined ? {} : { scenarios: options.scenario }),
            ...(options.studio === true ? { studio: true } : {}),
          })
          HCI.writeSuccess(
            `Captured ${result.captured} screenshots (${result.changed} changed, ${result.new} new, ${result.failed} failed): ${
              FS.displayPath(result.runPath)
            }\nTimeline: ${FS.displayPath(result.timelinePath)}\n`,
          )
          if (result.failed > 0) {
            Platform.runtimeProcess.setExitCode(1)
          }
        } catch (error) {
          HCI.writeErrorLine(Errors.formatForUser(error))
          Platform.runtimeProcess.setExitCode(1)
        }
      })
  }

  commands
    .command('compile')
    .argument('<appPath>', 'Tao app path to compile into the local runtime package.')
    .option('--app <name>', 'Select a named app when the file declares multiple apps.')
    .description('Compile a Tao app into the local runtime package.')
    .action(async (appPath: string, options: { app?: string }) => {
      try {
        const { runCompile } = await import('./compile-command')
        const compiled = await runCompile(appPath, { appName: options.app })
        HCI.writeSuccess(`Compiled ${compiled.sourcePath} -> ${compiled.outputPath}\n`)
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('facts')
    .argument('<projectRoot>', 'Project directory used to resolve a relative entry path.')
    .argument('<entryPath>', 'Tao app entry file, relative to projectRoot or absolute.')
    .argument('<appName>', 'App declaration to inspect.')
    .description('Print versioned, machine-readable semantic facts for one Tao app.')
    .action(async (projectRoot: string, entryPath: string, appName: string) => {
      try {
        const { runSemanticFacts } = await import('./semantic-commands')
        HCI.writeLine(JSON.stringify(await runSemanticFacts({ appName, entryPath, projectRoot })))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('coverage')
    .argument('<projectRoot>', 'Project directory used to resolve a relative entry path.')
    .argument('<entryPath>', 'Tao app entry file, relative to projectRoot or absolute.')
    .argument('<appName>', 'App declaration to inspect.')
    .argument('<view>', 'View declaration to report.')
    .description('Print versioned, machine-readable behavior-test coverage for one Tao view.')
    .action(async (projectRoot: string, entryPath: string, appName: string, view: string) => {
      try {
        const { runSemanticCoverage } = await import('./semantic-commands')
        HCI.writeLine(JSON.stringify(await runSemanticCoverage({ appName, entryPath, projectRoot, view })))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  commands
    .command('ship')
    .argument('[path]', 'Tao project file or directory to discover.', '.')
    .option('--app <name>', 'Select a named app instead of the one named in project metadata.')
    .option('--patch', 'Force a patch version bump.')
    .option('--minor', 'Force a minor version bump.')
    .option('--major', 'Force a major version bump.')
    .option('--yes', 'Proceed without the Y/n gate after printing the action list.')
    .option('--ignore-git', 'Allow shipping from a dirty Git working tree.')
    .option('--dry-run', 'Print precursors and the action list without mutating or contacting Apple.')
    .option('--no-wait', 'Return after upload without waiting for Apple processing.')
    .option('--notes <text>', 'Set TestFlight What to Test text instead of deriving it from Git.')
    .option('--beta [emails]', 'Distribute through TestFlight; optionally supply comma-separated recipients.')
    .option('--update', 'Publish a compatible bundle through the Tao update service.')
    .option('--rollback', 'With --update, republish the previously recorded update bundle.')
    .description('Build and ship a Tao app through App Store Connect or TestFlight.')
    .action(async (path: string, options: {
      app?: string
      beta?: boolean | string
      dryRun?: boolean
      ignoreGit?: boolean
      major?: boolean
      minor?: boolean
      wait?: boolean
      notes?: string
      patch?: boolean
      rollback?: boolean
      update?: boolean
      yes?: boolean
    }) => {
      try {
        const { runShipCommand } = await import('./ship-command')
        await runShipCommand(path, {
          appName: options.app,
          betaRecipients: parseBetaRecipients(options.beta),
          bump: shipBump(options),
          dryRun: options.dryRun,
          ignoreGit: options.ignoreGit,
          noWait: options.wait === false,
          notes: options.notes,
          rollback: options.rollback,
          update: options.update,
          yes: options.yes,
        })
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.setExitCode(1)
      }
    })

  commands
    .command('fmt')
    .argument('[paths...]', 'Tao files or directories to format. Defaults to the current directory.')
    .description('Format .tao files in place.')
    .action(async (paths: string[]) => {
      const { runFmt } = await import('./source-commands')
      await runInPlaceCommand(paths, runFmt, {
        changed: 'formatted',
        changedLine: 'Formatted',
        failedVerb: 'format',
      })
    })

  commands
    .command('fix')
    .argument('[paths...]', 'Tao files or directories to fix. Defaults to the current directory.')
    .description('Apply all Tao source fixes in place: renders last, organized use statements, formatting.')
    .action(async (paths: string[]) => {
      const { runFix } = await import('./source-commands')
      await runInPlaceCommand(paths, runFix, {
        changed: 'fixed',
        changedLine: 'Fixed',
        failedVerb: 'fix',
      })
    })

  commands
    .command('check')
    .argument('[paths...]', 'Tao files or directories to check. Defaults to the current directory.')
    .description('Check Tao source without writing: syntax errors, validation errors and warnings, and canonical form.')
    .action(async (paths: string[]) => {
      const { runCheck } = await import('./source-commands')
      await runInPlaceCommand(paths, runCheck, {
        changed: 'noncanonical',
        changedLine: 'Needs fixes',
        failedVerb: 'check',
        failOnChanged: true,
      })
    })

  commands
    .command('test')
    .argument('[paths...]', 'Tao test files or directories to search. Defaults to the current directory.')
    .option(
      '--name <pattern>',
      'Run only the tests whose name matches this pattern, case-insensitively, anywhere in'
        + ' "<file> <suite> > <test>". Runs every discovered test when omitted.',
    )
    .option(
      '--output <mode>',
      'Report the run as streamed lines or as a quiet summary with a log file (tui streams lines).'
        + ' Defaults to lines in a terminal and quiet otherwise.',
    )
    .option('--journey-observations <path>', 'Write versioned live render observations for this test run.')
    .option(
      '--pass-with-no-tests',
      'Exit with code 0 when --name selects no journey, instead of reporting it as a mistake in the'
        + ' pattern. For a scheduler running one pattern across many suites.',
    )
    .option('--shared-prepare <handoff-path>', 'Internal: validate and compile a shared Tao test run into a handoff.')
    .option('--shared-run <handoff-path>', 'Internal: run one shard from a prepared Tao test handoff.')
    .option('--shared-finalize <handoff-path>', 'Internal: settle a shared Tao test handoff after every shard passed.')
    .option(
      '--watch',
      'Run the selected tests, then rerun them on any change under the selected paths or the project'
        + ' roots of the selected tests, until Ctrl-C. A failing run'
        + ' keeps watching.',
    )
    .description('Run Tao tests declared in .tao files at or under the given paths.')
    .action(
      async (
        paths: string[],
        options: {
          journeyObservations?: string
          name?: string
          output?: string
          passWithNoTests?: boolean
          sharedFinalize?: string
          sharedPrepare?: string
          sharedRun?: string
          watch?: boolean
        },
      ) => {
        try {
          const sharedModes = [options.sharedPrepare, options.sharedRun, options.sharedFinalize]
            .filter(path => path !== undefined)
          if (sharedModes.length > 1) {
            Errors.throwUserInput('Pass only one shared Tao test phase at a time.')
          }
          if (options.watch && sharedModes.length > 0) {
            Errors.throwUserInput('--watch cannot run a shared Tao test phase.')
          }
          const testPaths = paths.length > 0 ? paths : ['.']
          if (options.sharedPrepare !== undefined) {
            const { prepareSharedTaoTestRun } = await import('./test-command')
            const outcome = await prepareSharedTaoTestRun(testPaths, options.sharedPrepare)
            if (outcome.failed) {
              Platform.runtimeProcess.exit(1)
            }
            return
          }
          if (options.sharedFinalize !== undefined) {
            if (paths.length > 0) {
              Errors.throwUserInput('--shared-finalize takes no Tao test paths.')
            }
            const { finalizeSharedTaoTestRun } = await import('./test-command')
            await finalizeSharedTaoTestRun(options.sharedFinalize)
            return
          }
          const { TestOutput } = await import('./test-output')
          const testOptions = {
            journeyObservationsPath: options.journeyObservations,
            name: options.name,
            output: TestOutput.resolveMode(options.output),
            passWithNoTests: options.passWithNoTests,
          }
          if (options.sharedRun !== undefined) {
            if (paths.length === 0) {
              Errors.throwUserInput('--shared-run requires one or more shard roots.')
            }
            const { runSharedTaoTestRun } = await import('./test-command')
            const outcome = await runSharedTaoTestRun(options.sharedRun, testPaths, testOptions)
            if (outcome.failed) {
              Platform.runtimeProcess.exit(1)
            }
            return
          }
          if (options.watch) {
            const { runTestWatchCommand } = await import('./test-watch')
            await runTestWatchCommand(testPaths, testOptions)
            return
          }
          const { runTestCommand } = await import('./test-command')
          await runTestCommand(testPaths, testOptions)
        } catch (error) {
          HCI.writeErrorLine(Errors.formatForUser(error))
          Platform.runtimeProcess.exit(1)
        }
      },
    )

  commands
    .command('completion')
    .description('Manage tao shell completions.')
    .command('install')
    .option('--shell <shell>', 'Install for a specific shell instead of the one $SHELL reports.')
    .description('Add the tao completion hook to your shell startup file.')
    .action(async (options: { shell?: string }) => {
      try {
        const { runCompletionInstall, writeCompletionInstallResult } = await import('./completion-command')
        writeCompletionInstallResult(await runCompletionInstall({ shell: options.shell }))
      } catch (error) {
        HCI.writeErrorLine(Errors.formatForUser(error))
        Platform.runtimeProcess.exit(1)
      }
    })

  // Registers `tao complete <shell>` to print a completion script, and the hidden request protocol it calls.
  // The adapter types against plain Commander, which extra-typings' generic Command does not widen to.
  tab(commands as unknown as BaseCommand)

  return commands
}

function parseBetaRecipients(value: boolean | string | undefined): string[] | undefined {
  if (value === undefined || value === false) {
    return undefined
  }
  if (value === true || value.trim().length === 0) {
    return []
  }
  const recipients = value.split(',').map(email => email.trim()).filter(Boolean)
  const invalid = recipients.find(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email))
  if (invalid) {
    Errors.throwUserInput(`TestFlight recipient '${invalid}' is not an email address.`)
  }
  return [...new Set(recipients)]
}

async function runSecretAction(work: () => Promise<void>): Promise<void> {
  try {
    await work()
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.setExitCode(1)
  }
}

function shipBump(
  options: { major?: boolean; minor?: boolean; patch?: boolean },
): 'major' | 'minor' | 'patch' | undefined {
  const selected = [
    ...(options.patch ? ['patch' as const] : []),
    ...(options.minor ? ['minor' as const] : []),
    ...(options.major ? ['major' as const] : []),
  ]
  if (selected.length > 1) {
    Errors.throwUserInput('Choose only one of --patch, --minor, or --major.')
  }
  return selected[0]
}

async function runInPlaceCommand(
  paths: string[],
  run: (root: string) => Promise<InPlace.Result[]>,
  labels: InPlaceLabels,
): Promise<void> {
  try {
    const roots = (paths.length > 0 ? paths : ['.']).map(path => FS.resolvePath(path))
    // Validate every root before touching files so a bad path cannot abort a partial run.
    for (const root of roots) {
      if (!await FS.exists(root)) {
        Errors.throwUserInput(`No file or directory found at ${root}`)
      }
    }
    const results: InPlace.Result[] = []
    for (const root of roots) {
      results.push(...await run(root))
    }
    const changed = results.filter(result => result.status === 'changed')
    const errored = results.filter(result => result.status === 'error')
    const diagnosticsOnly = results.filter(result => result.status === 'diagnostics')
    const diagnostics = results.flatMap(result => result.diagnostics ?? [])
    const errorCount = diagnostics.filter(Diagnostic.isError).length
      + results.reduce((held, result) => held + (result.unreportedDiagnostics ?? 0), 0)
      + errored.filter(result => result.error !== undefined).length
    const warningCount = diagnostics.filter(Diagnostic.isWarning).length

    writeChangedResults(changed, labels)
    await writeDiagnosticResults(results, labels)
    for (const result of errored.filter(result => result.error !== undefined)) {
      HCI.writeErrorLine(`Failed to ${labels.failedVerb} ${FS.displayPath(result.path)}: ${result.error}`)
    }
    if (results.length === 0) {
      HCI.writeLine(`No .tao files found under ${roots.map(FS.displayPath).join(', ')}`)
      return
    }

    const unchangedCount = results.length - changed.length - errored.length - diagnosticsOnly.length
    const summary = [
      `${changed.length} ${labels.changed}`,
      `${unchangedCount} unchanged`,
      ...countPhrase(errorCount, 'error'),
      ...countPhrase(warningCount, 'warning'),
    ].join(', ')
    const shouldFail = errorCount > 0 || labels.failOnChanged && changed.length > 0
    if (shouldFail) {
      HCI.writeErrorLine(summary)
      Platform.runtimeProcess.exit(1)
    }
    HCI.writeSuccess(`${summary}\n`)
  } catch (error) {
    HCI.writeErrorLine(Errors.formatForUser(error))
    Platform.runtimeProcess.exit(1)
  }
}

/**
 * writeDiagnosticResults prints every file's diagnostics with its location and offending source
 * line. The file is re-read for the excerpt because the run reports after all files are processed,
 * and only files that actually carry a diagnostic are read. A file that held findings back says so
 * once at the end of its own block, so the reader knows the list is a starting point.
 */
async function writeDiagnosticResults(results: readonly InPlace.Result[], labels: InPlaceLabels): Promise<void> {
  for (const result of results) {
    if (result.diagnostics === undefined || result.diagnostics.length === 0) {
      continue
    }
    const source = await FS.readText(result.path).catch(() => undefined)
    for (const diagnostic of result.diagnostics) {
      const block = DiagnosticReport.renderDiagnostic(diagnostic, source)
      if (Diagnostic.isError(diagnostic)) {
        HCI.logProcessError(labels.failedVerb, block)
      } else {
        HCI.logProcessWarn(labels.failedVerb, block)
      }
    }
    const held = result.unreportedDiagnostics ?? 0
    if (held > 0) {
      HCI.writeErrorLine(
        `${FS.displayPath(result.path)}: ${held} more error${held === 1 ? '' : 's'} further down this file. `
          + 'Fix these first — one mistake often explains the rest.',
      )
    }
  }
}

/** countPhrase returns a pluralized `N thing` phrase, or nothing at all when the count is zero. */
function countPhrase(count: number, noun: string): string[] {
  return count === 0 ? [] : [`${count} ${noun}${count === 1 ? '' : 's'}`]
}

function writeChangedResults(results: readonly InPlace.Result[], labels: InPlaceLabels): void {
  for (const result of results) {
    const line = `${labels.changedLine} ${FS.displayPath(result.path)}`
    if (labels.failOnChanged) {
      HCI.writeErrorLine(line)
    } else {
      HCI.writeSuccess(`${line}\n`)
    }
  }
}

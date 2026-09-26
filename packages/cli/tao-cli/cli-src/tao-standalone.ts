import { Errors, FS, HCI, Platform, TaoHome } from '@shared'
import { StandaloneResources } from './standalone-resources'
import { ToolchainPin } from './toolchain-pin'

// The entry point `bun build --compile` builds the distributable binary from. The resources are
// unpacked before the CLI is imported rather than inside it, because the CLI's modules resolve their
// resource roots as they load: an import that ran first would name `/$bunfs` for good. Before either,
// the run goes to the release it asks for, which may not be this one.

const [runtime, script, ...args] = Platform.runtimeProcess.argv
let runArgs: string[] = args
try {
  // This is the installed binary's entry point. Set child-tool caches and temporary storage before
  // loading the CLI so Expo, Metro, Bun, and DotSlash inherit paths within this Tao installation.
  const storage = {
    BUN_INSTALL_CACHE_DIR: TaoHome.resolve('cache/bun'),
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: TaoHome.resolve('cache/bun-runtime'),
    DOTSLASH_CACHE: TaoHome.resolve('cache/dotslash'),
    TMPDIR: TaoHome.resolve('tmp'),
    // Expo keeps auth state here too, so it is state rather than disposable cache.
    __UNSAFE_EXPO_HOME_DIRECTORY: TaoHome.resolve('state/expo'),
  }
  for (const path of Object.values(storage)) {
    await FS.mkdir(path)
  }
  Object.assign(Platform.runtimeProcess.env, storage)
  const delegation = await ToolchainPin.delegate(args)
  if ('exitCode' in delegation) {
    Platform.runtimeProcess.exit(delegation.exitCode)
  } else {
    runArgs = delegation.args
  }
  await StandaloneResources.ensureUnpacked()
} catch (error) {
  HCI.writeErrorLine(Errors.formatForUser(error))
  Platform.runtimeProcess.exit(1)
}

const { runTaoCli } = await import('./tao-cli')
await runTaoCli([runtime ?? 'tao', script ?? 'tao', ...runArgs])

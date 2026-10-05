import { FS, Platform, TaoResources } from '@shared'

// The bundled entrypoints initialize resources before importing compiler services.
// Source entrypoints have no adjacent payload and keep their checkout defaults.
const bundledResources = FS.resolvePath('..', import.meta.dir)
if (FS.existsSync(FS.resolvePath('stdlib/.tao', bundledResources))) {
  Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV] ||= bundledResources
  Platform.runtimeProcess.env['TAO_STDLIB_ROOT'] ||= FS.resolvePath(
    'stdlib',
    Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV],
  )
}

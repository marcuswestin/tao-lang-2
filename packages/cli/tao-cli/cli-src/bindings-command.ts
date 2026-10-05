import { generateMaintainedNativeBindings, generateNativeBindingFiles } from '@native-bindings'
import { Assert, FS, HCI, ReleaseCapabilities } from '@shared'

export type BindingsCommandOptions = {
  maintained?: boolean
  source?: string
  from?: string
  out?: string
  export?: string
  exclude?: string[]
}

/** Regenerate the maintained payload or one explicit installed package. */
export async function runBindingsGeneration(
  packageName: string | undefined,
  options: BindingsCommandOptions,
): Promise<void> {
  if (options.maintained === true) {
    Assert.input(
      packageName === undefined && options.source === undefined && options.out === undefined
        && options.export === undefined && options.exclude === undefined,
      '--maintained selects the maintained bindings; omit the package, --source, --out, --export and --exclude.',
    )
    HCI.logProcessInfo('bindings', 'Generating maintained native bindings')
    const files = await generateMaintainedNativeBindings({
      mode: 'write',
      ...(options.from === undefined ? {} : { sourceRoots: [FS.resolvePath(options.from)] }),
    })
    HCI.writeSuccess(`Generated maintained native bindings (${files.length} files)\n`)
    return
  }
  Assert.input(packageName !== undefined, 'Provide a package or use --maintained.')
  ReleaseCapabilities.require('native-bindings')
  Assert.input(options.source !== undefined, 'Provide --source expo or react-native for an explicit package.')
  Assert.input(options.out !== undefined, 'Provide --out for an explicit package.')
  HCI.logProcessInfo('bindings', `Generating native bindings for ${packageName}`)
  const files = await generateNativeBindingFiles(packageName, {
    source: options.source,
    from: options.from ?? '.',
    out: options.out,
    ...(options.export === undefined ? {} : { export: options.export }),
    ...(options.exclude === undefined ? {} : { exclude: options.exclude }),
  })
  HCI.writeSuccess(`Generated native bindings in ${FS.displayPath(FS.dirname(files[0]!))}\n`)
}

import { FS, Json } from '@shared'

export type ProjectNativeBindingInventory = {
  declarationRoots: readonly string[]
  outputRoots: readonly string[]
  shallowRoots: readonly string[]
  generatorRoots: readonly string[]
}

/** Compare directory membership without reading payloads or observing generated project trees. */
export async function projectNativeBindingInventory(plan: ProjectNativeBindingInventory): Promise<string> {
  const entries: string[] = []
  const auxiliary = FS.isFileMutationAuxiliaryPath
  const inspect = async (root: string, read: () => Promise<void>): Promise<void> => {
    try {
      await read()
    } catch (error) {
      // A concurrent directory replacement is itself a membership change. The
      // following scan reads its new inventory; other filesystem failures surface.
      if (Json.isRecord(error) && (error['code'] === 'ENOENT' || error['code'] === 'ENOTDIR')) {
        entries.push(`replaced:${root}`)
      } else {
        throw error
      }
    }
  }
  const shallow = async (root: string, scopes: boolean): Promise<void> => {
    if (!await FS.isDirectory(root)) {
      entries.push(`missing:${root}`)
      return
    }
    entries.push(`directory:${root}`)
    for (const name of await FS.listDir(root)) {
      const path = FS.resolvePath(name, root)
      if (auxiliary(path) || ['.tao-ts', '.tao', '.artifacts', '.expo', '.git'].includes(name)) {
        continue
      }
      entries.push(path)
      if (await FS.isSymbolicLink(path)) {
        entries.push(`${path}->${await FS.realPath(path).catch(() => 'missing')}`)
      }
      if (scopes && name.startsWith('@')) {
        await shallow(path, false)
      }
    }
  }
  for (const root of plan.shallowRoots) {
    await inspect(root, () => shallow(root, false))
  }
  for (const root of plan.generatorRoots) {
    if (!await FS.isDirectory(root)) {
      entries.push(`missing:${root}`)
      continue
    }
    entries.push(`directory:${root}`)
    await inspect(root, async () => {
      for await (
        const path of FS.walk(root, {
          includeHidden: true,
          excludeDirectory: name =>
            ['node_modules', '.tao-ts', '.tao', '.artifacts', '.expo', '.git'].includes(name) || auxiliary(name),
        })
      ) {
        if (path.endsWith('.ts') && !auxiliary(path)) {
          entries.push(path)
        }
      }
    })
  }
  for (const root of plan.shallowRoots) {
    const modules = FS.resolvePath('node_modules', root)
    if (await FS.isDirectory(modules)) {
      await inspect(modules, () => shallow(modules, true))
    }
  }
  for (const [roots, declarations] of [[plan.declarationRoots, true], [plan.outputRoots, false]] as const) {
    for (const root of roots) {
      if (!await FS.isDirectory(root)) {
        entries.push(`missing:${root}`)
        continue
      }
      entries.push(`directory:${root}`)
      await inspect(root, async () => {
        for await (
          const path of FS.walk(root, {
            includeHidden: true,
            excludeDirectory: name =>
              declarations && (name === 'node_modules' || name === '.tao-ts')
              || auxiliary(name),
          })
        ) {
          if (
            !auxiliary(path)
            && (!declarations || /\.d\.[cm]?ts$/.test(path) || FS.basename(path) === 'package.json')
          ) {
            entries.push(path)
          }
        }
      })
    }
  }
  return JSON.stringify(entries.sort())
}

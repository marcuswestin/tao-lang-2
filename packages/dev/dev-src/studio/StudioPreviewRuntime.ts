import { FS, Repo } from '@shared'

const runtimeFiles = [
  'app.json',
  'index.ts',
  'metro.config.cjs',
  'package.json',
] as const

export type CreatedStudioPreviewRuntime = {
  close: () => Promise<void>
  root: string
}

/** StudioPreviewRuntime creates an isolated Expo project for one Studio process. */
export const StudioPreviewRuntime = {
  create,
}

async function create(sourceRoot: string): Promise<CreatedStudioPreviewRuntime> {
  const artifactRoot = Repo.resolvePath('.artifacts/dev/studio-preview')
  await FS.mkdir(artifactRoot)
  const root = await FS.mkTmpDir(FS.resolvePath('runtime-', artifactRoot))
  try {
    await Promise.all(
      runtimeFiles.map(file => FS.copyFile(FS.resolvePath(file, sourceRoot), FS.resolvePath(file, root))),
    )
    await FS.symlink(FS.resolvePath('node_modules', sourceRoot), FS.resolvePath('node_modules', root))
    return {
      close: () => FS.remove(root),
      root,
    }
  } catch (error) {
    await FS.remove(root)
    throw error
  }
}

import { Assert, FS } from '@shared'

export type ReleaseBundleProof = {
  bundleFiles: readonly string[]
  studioMarker: 'taoStudioParentOrigin'
}

const bundleExtensions = new Set(['.bundle', '.hbc', '.js'])
const studioMarker = 'taoStudioParentOrigin' as const

/** proveReleaseBundle verifies an exported native bundle exists and carries no Studio preview bridge. */
export async function proveReleaseBundle(exportRoot: string): Promise<ReleaseBundleProof> {
  Assert(await FS.isDirectory(exportRoot), 'release bundle export directory exists', { exportRoot })
  const bundleFiles: string[] = []
  const filesWithStudio: string[] = []
  for await (const path of FS.walk(exportRoot)) {
    if (!bundleExtensions.has(FS.extname(path))) {
      continue
    }
    bundleFiles.push(path)
    if (new TextDecoder().decode(await FS.readFile(path)).includes(studioMarker)) {
      filesWithStudio.push(path)
    }
  }
  Assert(bundleFiles.length > 0, 'release export contains a JavaScript or Hermes bundle', { exportRoot })
  Assert(filesWithStudio.length === 0, 'release bundle excludes Tao Studio modules', {
    filesWithStudio,
  })
  return { bundleFiles: bundleFiles.toSorted(), studioMarker }
}

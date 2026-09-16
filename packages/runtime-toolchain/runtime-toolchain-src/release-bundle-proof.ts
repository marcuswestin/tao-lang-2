import { Assert, Errors, FS, Json } from '@shared'

export type ReleaseBundleProof = {
  bundleFiles: readonly string[]
  studioMarker: 'taoStudioParentOrigin'
}

export type ExpoUpdateArtifact = {
  contentType: string
  fileExtension?: string
  key: string
  path: string
}

export type ExpoUpdateArtifacts = {
  assets: readonly ExpoUpdateArtifact[]
  launchAsset: ExpoUpdateArtifact
}

type ExpoExportPlatformMetadata = {
  assets: Array<{ ext: string; path: string }>
  bundle: string
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

/**
 * expoUpdateArtifacts reads Expo's own export inventory instead of treating every file in the
 * export directory as a client asset. Asset paths are extensionless by design; metadata owns the
 * extension expo-updates needs when it materializes the downloaded file.
 */
export async function expoUpdateArtifacts(
  exportRoot: string,
  platform: 'android' | 'ios',
): Promise<ExpoUpdateArtifacts> {
  const metadataPath = FS.resolvePath('metadata.json', exportRoot)
  let metadata: unknown
  try {
    metadata = await FS.readJson<unknown>(metadataPath)
  } catch (error) {
    Errors.throwHostEnvironment(`Expo did not produce readable update metadata at ${metadataPath}.`, { cause: error })
  }
  if (
    !Json.isRecord(metadata)
    || metadata['version'] !== 0
    || metadata['bundler'] !== 'metro'
    || !Json.isRecord(metadata['fileMetadata'])
    || !isPlatformMetadata(metadata['fileMetadata'][platform])
  ) {
    Errors.throwHostEnvironment(`Expo did not produce ${platform} update metadata at ${metadataPath}.`)
  }
  const platformMetadata = metadata['fileMetadata'][platform]
  const platformName = platform === 'ios' ? 'iOS' : 'Android'
  const launchPath = await declaredArtifactPath(
    exportRoot,
    platformMetadata.bundle,
    `${platformName} update metadata names an invalid launch bundle`,
  )
  const launchExtension = FS.extname(launchPath)
  const assets = await Promise.all(platformMetadata.assets.map(async asset => {
    const path = await declaredArtifactPath(
      exportRoot,
      asset.path,
      `${platformName} update metadata names an invalid asset`,
    )
    const fileExtension = normalizedExtension(asset.ext)
    return {
      contentType: updateContentType(fileExtension),
      ...(fileExtension.length === 0 ? {} : { fileExtension }),
      key: FS.basename(asset.path),
      path,
    }
  }))
  return {
    assets,
    launchAsset: {
      contentType: 'application/javascript',
      ...(launchExtension.length === 0 ? {} : { fileExtension: launchExtension }),
      key: 'bundle',
      path: launchPath,
    },
  }
}

function isPlatformMetadata(value: unknown): value is ExpoExportPlatformMetadata {
  return Json.isRecord(value)
    && typeof value['bundle'] === 'string'
    && Array.isArray(value['assets'])
    && value['assets'].every(asset =>
      Json.isRecord(asset) && typeof asset['path'] === 'string' && typeof asset['ext'] === 'string'
    )
}

async function declaredArtifactPath(exportRoot: string, relativePath: string, label: string): Promise<string> {
  const path = FS.resolvePath(relativePath, exportRoot)
  if (
    relativePath.length === 0
    || relativePath.startsWith('/')
    || /^[A-Za-z]:[\\/]/u.test(relativePath)
    || !FS.pathIsWithin(path, exportRoot)
    || !await FS.isFile(path)
  ) {
    Errors.throwHostEnvironment(`Expo ${label} '${relativePath}': the file is missing or escapes the export directory.`)
  }
  return path
}

function normalizedExtension(extension: string): string {
  const trimmed = extension.trim()
  if (trimmed.length === 0) {
    return ''
  }
  if (!/^\.?[A-Za-z0-9]+$/u.test(trimmed)) {
    Errors.throwHostEnvironment(`Expo update metadata contains invalid asset extension '${extension}'.`)
  }
  return trimmed.startsWith('.') ? trimmed : `.${trimmed}`
}

function updateContentType(extension: string): string {
  if (extension === '.js' || extension === '.bundle') {
    return 'application/javascript'
  }
  if (extension === '.json') {
    return 'application/json'
  }
  if (extension === '.png') {
    return 'image/png'
  }
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  return 'application/octet-stream'
}

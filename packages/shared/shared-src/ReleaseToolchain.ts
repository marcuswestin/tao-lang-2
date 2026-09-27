import * as Errors from './core/Errors'
import * as Json from './core/Json'
import * as Text from './core/Text'
import * as FS from './FS'
import { ReleaseCapabilities, type ReleaseProfile } from './ReleaseCapabilities'

declare const TAO_RELEASE_VERSION: string | undefined

type ToolchainIdentity = Readonly<{ version: string; profile: ReleaseProfile }>

function current(): ToolchainIdentity {
  return {
    version: typeof TAO_RELEASE_VERSION === 'undefined' ? 'development' : TAO_RELEASE_VERSION,
    profile: ReleaseCapabilities.current(),
  }
}

/** Check the actual document/project boundary, including projects nested in an editor workspace. */
async function requireMatchingProjectRelease(
  startPath: string,
  surface: 'editor' | 'Studio',
  own: ToolchainIdentity = current(),
): Promise<void> {
  let directory = FS.resolvePath(startPath)
  if (await FS.isFile(directory)) {
    directory = FS.dirname(directory)
  }
  while (true) {
    const path = FS.resolvePath('.tao-project/lock.jsonc', directory)
    if (await FS.isFile(path)) {
      const lock: unknown = JSON.parse(Text.stripJsonc(await FS.readText(path)))
      const toolchain = Json.isRecord(lock) ? lock['toolchain'] : undefined
      const pinned = Json.isRecord(toolchain) ? toolchain['version'] : undefined
      const releaseProfile = Json.isRecord(toolchain) ? toolchain['releaseProfile'] : undefined
      const phase = Json.isRecord(releaseProfile) ? releaseProfile['phase'] : undefined
      const fingerprint = Json.isRecord(releaseProfile) ? releaseProfile['fingerprint'] : undefined
      if (
        typeof pinned === 'string' && (
          pinned !== own.version
          || (pinned !== 'development' && own.profile.phase === 'development')
          || (phase !== undefined && phase !== own.profile.phase)
          || (fingerprint !== undefined && fingerprint !== ReleaseCapabilities.fingerprint(own.profile))
        )
      ) {
        Errors.throwUserInput(
          `This project pins Tao ${pinned}${
            phase === undefined ? '' : ` phase ${String(phase)}`
          }, but this ${surface} bundles Tao ${own.version} phase ${own.profile.phase}. Install the matching Tao ${surface} release before validating this project.`,
        )
      }
      return
    }
    const parent = FS.dirname(directory)
    if (parent === directory) {
      return
    }
    directory = parent
  }
}

export const ReleaseToolchain = { current, requireMatchingProjectRelease } as const

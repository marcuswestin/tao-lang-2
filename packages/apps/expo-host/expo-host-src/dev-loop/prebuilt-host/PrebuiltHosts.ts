import { Errors, FS, Repo } from '@shared'
import { DevLoopOutput } from '../DevLoopOutput'
import {
  HOST_BINARIES,
  hostKitProblems,
  type HostManifest,
  type HostPlatform,
  type NativeKit,
  readHostManifest,
} from './HostManifest'
import { downloadCompatibleHost, taoHostsRoot } from './HostReleases'

/*
 * Where `tao dev` finds a prebuilt host, and which one it takes. Hosts are cached as
 * `<root>/<hostKey>/<platform>/`, a binary beside its manifest, but the path is only where one was
 * put: a host is taken because its manifest's native kit covers the kit this Tao computes for
 * itself, never because of the directory it sits in. The roots are Tao's own home — `$TAO_HOME`, or
 * `~/.tao` — where downloaded hosts land, and, inside a Tao checkout, the hosts that checkout built.
 */

/** CHECKOUT_HOSTS_PATH is where a Tao checkout's own host builds land, relative to its root. */
export const CHECKOUT_HOSTS_PATH = '.artifacts/hosts'

/** PrebuiltHost is one host `tao dev` can install: its directory, manifest, and binary. */
export type PrebuiltHost = {
  binaryPath: string
  directory: string
  manifest: HostManifest
}

/** HostSearch is the host a search chose, if any, and why every host it passed over was refused. */
export type HostSearch = {
  host?: PrebuiltHost
  refused: string[]
}

/** hostRoots lists the directories hosts are cached under, in the order a search prefers them. */
function hostRoots(): string[] {
  const roots = [taoHostsRoot()]
  const checkoutHosts = Repo.tryResolvePath(CHECKOUT_HOSTS_PATH)
  if (checkoutHosts !== undefined) {
    roots.push(checkoutHosts)
  }
  return roots
}

/**
 * obtainCompatibleHost is how `tao dev` gets a host: a cached one whose kit covers `required`, or
 * else the newest published one that does, downloaded into Tao's home. A download that cannot
 * happen — offline, rate-limited, or releases not yet public — is one calm line, and the caller
 * falls back to Expo Go as it would with no host at all.
 */
export async function obtainCompatibleHost(
  platform: HostPlatform,
  required: NativeKit,
  seams: { download?: typeof downloadCompatibleHost; roots?: readonly string[] } = {},
): Promise<HostSearch> {
  const cached = await findCompatibleHost(platform, required, seams.roots)
  if (cached.host !== undefined) {
    return cached
  }
  try {
    const published = await (seams.download ?? downloadCompatibleHost)(platform, required)
    return { ...published, refused: [...cached.refused, ...published.refused] }
  } catch (error) {
    DevLoopOutput.logDevLoop('dev', `No prebuilt host could be downloaded: ${Errors.formatForUser(error)}`)
    return cached
  }
}

/**
 * findCompatibleHost returns the newest host for `platform` whose native kit covers `required`,
 * and a one-line reason for each host it refused, so a caller falling back to another runtime can
 * say why rather than just that it did.
 */
export async function findCompatibleHost(
  platform: HostPlatform,
  required: NativeKit,
  roots: readonly string[] = hostRoots(),
): Promise<HostSearch> {
  const refused: string[] = []
  for (const root of roots) {
    if (!await FS.isDirectory(root)) {
      continue
    }
    const versions = (await FS.listDir(root))
      .toSorted((left, right) => right.localeCompare(left, undefined, { numeric: true }))
    for (const version of versions) {
      const directory = FS.resolvePath(`${version}/${platform}`, root)
      const verdict = await judgeHost(directory, platform, required)
      if (typeof verdict !== 'string') {
        return { host: verdict, refused }
      }
      if (verdict !== '') {
        refused.push(`${FS.displayPath(directory)}: ${verdict}`)
      }
    }
  }
  return { refused }
}

/** A chosen host, or why this directory was refused; an empty reason means it holds no host at all. */
async function judgeHost(
  directory: string,
  platform: HostPlatform,
  required: NativeKit,
): Promise<PrebuiltHost | string> {
  let manifest: HostManifest | undefined
  try {
    manifest = await readHostManifest(directory)
  } catch (error) {
    return Errors.formatForUser(error)
  }
  if (manifest === undefined) {
    return ''
  }
  if (manifest.platform !== platform) {
    return `its manifest is for ${manifest.platform}, not ${platform}`
  }
  const binaryPath = FS.resolvePath(HOST_BINARIES[platform], directory)
  if (!await FS.exists(binaryPath)) {
    return `no ${HOST_BINARIES[platform]} beside its manifest`
  }
  const problems = hostKitProblems(manifest.nativeKit, required)
  if (problems.length > 0) {
    return problems.join('; ')
  }
  return { binaryPath, directory, manifest }
}

import { Errors, FS, Platform, TaoResources } from '@shared'

/**
 * StandaloneResources owns the resource payload a distributable Tao binary carries, and putting it
 * on disk. Everything a child process reads — the stdlib whose sidecars a project's Metro resolves,
 * the runtime a project's `tsconfig.json` links, the Expo host's toolchain files — must be a real
 * file, and the binary's own tree is inside `/$bunfs`, which only the binary can read. The build
 * packs that tree into one archive the binary embeds, and the binary's entry point unpacks it
 * beside itself before the CLI loads, where `TaoResources` finds it.
 *
 * The completion stamp holds the payload's content identity and is written last, into a staging
 * tree that is then renamed into place. So the tree beside a binary is absent, complete for some
 * payload, or complete for this one, and only the last is taken as it stands: a binary rebuilt into
 * the same directory replaces what an older build unpacked rather than reading a stdlib it never
 * shipped.
 *
 * The resource directory itself is a symlink onto a sibling named for the payload's identity, and
 * that indirection is what makes replacing a tree safe. A directory cannot be renamed over a
 * non-empty one, so replacing a real directory means moving the old one aside first, and in that
 * gap the path does not exist: a first run probing then would settle on `/$bunfs` for good. A
 * symlink can be renamed over another, so a reader sees the previous tree or the new one and never
 * neither, and two first runs of one binary race only to create the same identity-named tree.
 */

/**
 * PAYLOAD_FILE_NAME is the archive the build embeds. It has one extension because Bun inserts its
 * content hash before the last dot, and `tao-resources.tar-<hash>.gz` would name neither format.
 */
const PAYLOAD_FILE_NAME = 'tao-resources.tgz'
const PAYLOAD_STEM = 'tao-resources'
const PAYLOAD_EXTENSION = '.tgz'

/** How much of the payload's identity names its tree: enough to tell builds apart, short to read. */
const TREE_IDENTITY_LENGTH = 16

/** STAGING_MARKER separates a tree's name from the unique suffix of a staging copy of it. */
const STAGING_MARKER = '.tmp-'

/** StandaloneResources owns the embedded resource payload and its unpacked tree. */
export const StandaloneResources = {
  PAYLOAD_FILE_NAME,
  ensureUnpacked,
  unpack,
} as const

/**
 * ensureUnpacked puts this binary's payload on disk beside it, unless a declared resource root makes
 * that tree irrelevant. It returns the unpacked directory, or undefined when there is nothing to
 * unpack — which is every run from source, where the resources already sit beside their readers.
 */
async function ensureUnpacked(): Promise<string | undefined> {
  if (Platform.runtimeProcess.env[TaoResources.DECLARED_ROOT_ENV]) {
    // The declared root wins in `TaoResources`, and it is also how a binary installed somewhere it
    // cannot write is made usable, so it must not first require that write.
    return undefined
  }
  // Bun types these as plain blobs; at runtime each carries the `name` it was embedded under.
  const embedded = Bun.embeddedFiles as ReadonlyArray<Blob & { readonly name?: string }>
  const payload = embedded.find(file => file.name !== undefined && isPayloadName(file.name))
  if (payload === undefined) {
    return undefined
  }
  return await unpack(await payload.bytes(), TaoResources.installedDirectory())
}

/**
 * unpack makes `directory` a complete tree of `archive`'s contents, stamped with its identity. A
 * tree already stamped with that identity is kept as it stands, so the second run of a binary costs
 * one hash and one small read. Trees from earlier payloads are removed once the link has moved off
 * them.
 */
async function unpack(archive: Uint8Array, directory: string): Promise<string> {
  const identity = Platform.sha256Hex(archive)
  if (await stampedWith(directory, identity)) {
    return directory
  }
  const treeName = `${treePrefix(directory)}${identity.slice(0, TREE_IDENTITY_LENGTH)}`
  const tree = FS.resolvePath(treeName, FS.dirname(directory))
  try {
    if (!await stampedWith(tree, identity)) {
      await extractTree(archive, identity, tree)
    }
    if (!await FS.isSymbolicLink(directory) && await FS.exists(directory)) {
      // A real directory here predates the link; no released build wrote one.
      await FS.remove(directory)
    }
    // Relative, so the whole install can move without the link going stale.
    await FS.replaceSymlink(treeName, directory)
  } catch (error) {
    if (!await stampedWith(directory, identity)) {
      Errors.throwHostEnvironment(
        `Tao could not unpack its resources into ${directory}. Install Tao somewhere it can write, `
          + `or set ${TaoResources.DECLARED_ROOT_ENV} to an unpacked resource tree.`,
        { cause: error },
      )
    }
  }
  await removeSupersededTrees(directory, treeName)
  return directory
}

/**
 * extractTree writes the payload to `tree` through a staging directory, stamping it last. A
 * concurrent first run can place the same tree first, and losing that rename is not an error.
 */
async function extractTree(archive: Uint8Array, identity: string, tree: string): Promise<void> {
  const staging = `${tree}${STAGING_MARKER}${Platform.runtimeProcess.pid}-${Platform.randomUUID()}`
  try {
    await new Bun.Archive(archive).extract(staging)
    await FS.writeText(FS.resolvePath(TaoResources.COMPLETION_STAMP, staging), identity)
    await FS.move(staging, tree).catch(async (error: unknown) => {
      if (!await stampedWith(tree, identity)) {
        throw error
      }
    })
  } finally {
    // Best effort: a cleanup failure must not replace the error that says what actually went wrong.
    await FS.remove(staging).catch(() => undefined)
  }
}

/**
 * removeSupersededTrees deletes the trees earlier payloads left beside `directory`. Staging trees
 * are left alone, because another first run may be writing one now.
 */
async function removeSupersededTrees(directory: string, currentTree: string): Promise<void> {
  const parent = FS.dirname(directory)
  const prefix = treePrefix(directory)
  const siblings = await FS.listDir(parent).catch(() => [])
  for (const name of siblings) {
    if (name.startsWith(prefix) && name !== currentTree && !name.includes(STAGING_MARKER)) {
      await FS.remove(FS.resolvePath(name, parent)).catch(() => undefined)
    }
  }
}

/** treePrefix names the hidden siblings that hold each payload's tree: `.resources-<identity>`. */
function treePrefix(directory: string): string {
  return `.${FS.basename(directory)}-`
}

/** stampedWith reports whether `directory` is a complete unpack of the payload with `identity`. */
async function stampedWith(directory: string, identity: string): Promise<boolean> {
  const stamp = FS.resolvePath(TaoResources.COMPLETION_STAMP, directory)
  return await FS.readText(stamp).then(content => content === identity, () => false)
}

/** isPayloadName matches the embedded archive with or without the hash Bun's asset naming adds. */
function isPayloadName(name: string): boolean {
  return name === PAYLOAD_FILE_NAME || (name.startsWith(`${PAYLOAD_STEM}-`) && name.endsWith(PAYLOAD_EXTENSION))
}

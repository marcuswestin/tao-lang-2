import { CLI, FS, LocalSocket, Platform, Switch } from '@shared'
import type { DoctorCheck } from './RepositoryDoctor'

/**
 * What the doctors know about Watchman, read without starting it or creating a watch.
 *
 * An agent sandbox refuses OS file watching outright — even one `fs.watch` of an empty directory
 * fails, reported as `EMFILE: too many open files, watch` although nothing is exhausted — and no
 * sandbox is given Watchman's per-login socket either (`.rulesync/permissions.jsonc` says why). So
 * file-watching dev loops run on the host through named operations, a sandbox that cannot reach
 * Watchman is expected. A missing client fails, while a stopped server warns because host dev loops
 * can start it or use OS watching and sandboxed tests and builds crawl without it.
 *
 * The server is asked directly over its socket, never through the `watchman` client: the client
 * spawns a server when it may, so a diagnosis would change the machine, and answers some commands
 * itself when it may not, so a dead server can look alive. A sandbox that denies the socket makes
 * the connection fail exactly as a missing socket does, so whether the socket file exists is what
 * tells the two apart.
 */

/** Where launchd reads how to restart Watchman on macOS. Watchman writes it on its first start. */
const LAUNCH_AGENT_PATH = 'Library/LaunchAgents/com.github.facebook.watchman.plist'

/** The pinned client inside a checkout's devenv profile. */
const PROFILE_WATCHMAN = '.devenv/profile/bin/watchman'

const FALLBACK =
  'Metro and Jest fall back to crawling and OS file watching, slower on the host and refused in a sandbox'

/** WatchmanServer is what connecting to the server's socket found. */
export type WatchmanServer =
  | { readonly roots: readonly string[]; readonly state: 'answering' }
  /** The socket exists but this process may not connect to it: a sandbox denies it. */
  | { readonly state: 'denied' }
  /** No socket, or a socket nothing is listening on. */
  | { readonly state: 'not-running' }

/** WatchmanFacts is everything the Watchman checks read. */
export type WatchmanFacts = {
  /** The pinned client's version, or undefined when no `watchman` is on PATH. */
  readonly clientVersion?: string
  /** What launchd restarts Watchman from, when a LaunchAgent exists. */
  readonly launchAgent?: {
    readonly program: string
    readonly programPresent: boolean
    /** The linked worktree the program lives inside, which disappears when that worktree does. */
    readonly linkedWorktree?: string
  }
  /** The checkout being diagnosed, symlinks resolved, as Watchman reports its roots. */
  readonly repositoryRoot: string
  readonly server?: WatchmanServer
  /** The socket the client names for this login. */
  readonly socket?: string
  /** A client path that outlives every linked worktree: the primary checkout's pinned one. */
  readonly stableClient?: string
}

/** watchmanChecks diagnoses Watchman from a gathered snapshot. */
export function watchmanChecks(facts: WatchmanFacts): DoctorCheck[] {
  return [serverCheck(facts), watchRootCheck(facts), ...launchAgentChecks(facts)]
}

/** enclosingWatchRoot returns a watched root that holds `repositoryRoot` inside it, if any. */
export function enclosingWatchRoot(roots: readonly string[], repositoryRoot: string): string | undefined {
  return roots.find(root => root !== repositoryRoot && FS.pathIsWithin(repositoryRoot, root))
}

function serverCheck(facts: WatchmanFacts): DoctorCheck {
  const name = 'watchman'
  if (facts.clientVersion === undefined) {
    return {
      detail: `no watchman on PATH; ${FALLBACK}`,
      name,
      remediation: `It ships in the pinned devenv profile: put ${
        FS.dirname(PROFILE_WATCHMAN)
      } on PATH, or run ./agent setup`,
      status: 'fail',
    }
  }
  const socket = FS.displayPath(facts.socket ?? '')
  return Switch<WatchmanServer['state'], DoctorCheck>(facts.server?.state ?? 'not-running', {
    answering: () => ({ detail: `${facts.clientVersion}, answering at ${socket}`, name, status: 'pass' }),
    // By design (see .rulesync/permissions.jsonc): no agent sandbox is given Watchman's per-login
    // socket, so file-watching dev loops run on the host, and sandboxed tests and builds crawl without it.
    denied: () => ({
      detail: `${facts.clientVersion} is running, and this shell's sandbox leaves its socket out by design; `
        + 'file-watching dev loops run on the host',
      name,
      remediation: 'Run them as ./agent unsandboxed app-dev or ./agent unsandboxed studio',
      status: 'pass',
    }),
    'not-running': () => ({
      detail: `no Watchman server is running; ${FALLBACK}`,
      name,
      remediation: 'Start the shared per-user daemon with ./agent unsandboxed watchman start',
      status: 'warn',
    }),
  })
}

function watchRootCheck(facts: WatchmanFacts): DoctorCheck {
  const name = 'watchman root'
  if (facts.server?.state !== 'answering') {
    return { detail: 'not checked: no Watchman server answered', name, status: 'pass' }
  }
  const enclosing = enclosingWatchRoot(facts.server.roots, facts.repositoryRoot)
  if (enclosing !== undefined) {
    return {
      // Watchman resolves a checkout to an existing enclosing watch before its own root marker, so
      // every worktree under a watched primary checkout shares one watch of all of them.
      detail: `Watchman watches ${FS.displayPath(enclosing)}, which encloses this checkout, so Metro here `
        + 'queries one watch of every worktree beneath it instead of this checkout alone',
      name,
      remediation: `Once no dev server uses it (\`watchman debug-get-subscriptions ${enclosing}\` lists none): `
        + `watchman watch-del ${enclosing}`,
      status: 'fail',
    }
  }
  const watched = facts.server.roots.includes(facts.repositoryRoot)
  return {
    detail: watched ? 'this checkout is watched as its own root' : 'this checkout is not watched yet',
    name,
    status: 'pass',
  }
}

function launchAgentChecks(facts: WatchmanFacts): DoctorCheck[] {
  const agent = facts.launchAgent
  if (agent === undefined) {
    return []
  }
  const name = 'watchman launch agent'
  // launchd restarts the server only after a crash, not after it is told to stop, and only from
  // the path Watchman wrote when it last started. A path that is gone leaves it stopped.
  // Both halves name the pinned client: a bare `watchman` resolves through whatever PATH the terminal
  // has, and one that misses this server leaves the old LaunchAgent in place. Stopping the server drops
  // every dev server's subscriptions on the machine, hence the timing.
  const rewrite = 'While no dev server is running, run ./agent unsandboxed watchman stop, '
    + 'then ./agent unsandboxed watchman start (shared by all worktrees).'
  if (!agent.programPresent) {
    return [{
      detail: `launchd restarts Watchman from ${FS.displayPath(agent.program)}, which no longer exists`,
      name,
      remediation: rewrite,
      status: 'warn',
    }]
  }
  if (agent.linkedWorktree !== undefined) {
    return [{
      detail: `launchd restarts Watchman from inside the linked worktree ${FS.displayPath(agent.linkedWorktree)}, `
        + 'so it cannot restart once that worktree is removed',
      name,
      remediation: rewrite,
      status: 'warn',
    }]
  }
  return [{ detail: `restarts from ${FS.displayPath(agent.program)}`, name, status: 'pass' }]
}

/** readWatchmanFacts inspects Watchman without starting a server or creating a watch. */
export async function readWatchmanFacts(repositoryRoot: string): Promise<WatchmanFacts> {
  const [clientVersion, socket, checkouts, canonicalRoot] = await Promise.all([
    readClientVersion(),
    readSocket(),
    readCheckouts(repositoryRoot),
    FS.realPath(repositoryRoot).catch(() => repositoryRoot),
  ])
  const facts: WatchmanFacts = {
    ...(clientVersion === undefined ? {} : { clientVersion }),
    ...(socket === undefined ? {} : { server: await readWatchmanServer(socket), socket }),
    repositoryRoot: canonicalRoot,
    ...(checkouts.primary === undefined ? {} : { stableClient: FS.resolvePath(PROFILE_WATCHMAN, checkouts.primary) }),
  }
  const launchAgent = await readLaunchAgent(checkouts.linked)
  return launchAgent === undefined ? facts : { ...facts, launchAgent }
}

async function readClientVersion(): Promise<string | undefined> {
  const result = await CLI.run('watchman', { args: ['--version'] })
  const version = result.stdout.trim()
  return result.error === undefined && result.exitCode === 0 && version !== '' ? version : undefined
}

/** readSocket asks the client where this login's socket is; the client answers without a server. */
async function readSocket(): Promise<string | undefined> {
  const result = await CLI.run('watchman', { args: ['--no-pretty', 'get-sockname', '--no-spawn'] })
  return result.error === undefined ? watchmanSocketFromClient(result) : undefined
}

/**
 * watchmanSocketFromClient reads the socket path from the client's `get-sockname` answer. In an
 * agent sandbox the client cannot even answer that: it first tightens its state directory's mode,
 * which the sandbox refuses, and the refusal names the directory the socket lives in, as `sock`.
 */
export function watchmanSocketFromClient(
  result: { exitCode: number | null; stderr: string; stdout: string },
): string | undefined {
  if (result.exitCode === 0) {
    try {
      const sockname = (JSON.parse(result.stdout) as { sockname?: unknown }).sockname
      return typeof sockname === 'string' && sockname !== '' ? sockname : undefined
    } catch {
      return undefined
    }
  }
  const stateDirectory = /fchmod\((\/[^,]+), \d+\): Operation not permitted/u.exec(`${result.stderr}\n${result.stdout}`)
  return stateDirectory === null ? undefined : FS.resolvePath('sock', stateDirectory[1]!)
}

/** How a sandbox's denial of a Unix socket surfaces; macOS reports it as a missing file. */
const DENIAL_CODES = new Set(['EACCES', 'ENOENT', 'EPERM'])

/**
 * readWatchmanServer connects to `socket` and asks the server what it watches. Inside an agent
 * sandbox any failure to reach an existing socket is the sandbox's: Bun reports the denied connect
 * as `ECONNREFUSED`, the code a stopped server gives too.
 */
export async function readWatchmanServer(
  socket: string,
  request: (socket: string, command: readonly string[]) => Promise<{ roots?: unknown }> = LocalSocket.request,
  sandboxed = CLI.inAgentSandbox(),
): Promise<WatchmanServer> {
  try {
    const response = await request(socket, ['watch-list'])
    const roots = Array.isArray(response.roots)
      ? response.roots.filter((root): root is string => typeof root === 'string')
      : []
    return { roots, state: 'answering' }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? ''
    return (sandboxed || DENIAL_CODES.has(code)) && await FS.exists(socket)
      ? { state: 'denied' }
      : { state: 'not-running' }
  }
}

/** readCheckouts names the primary checkout and every linked worktree of this repository. */
async function readCheckouts(repositoryRoot: string): Promise<{ linked: string[]; primary?: string }> {
  const result = await CLI.run('git', { args: ['worktree', 'list', '--porcelain'], cwd: repositoryRoot })
  const paths = result.exitCode === 0
    ? result.stdout.split('\n').filter(line => line.startsWith('worktree ')).map(line => line.slice(9))
    : []
  // git lists the primary checkout first.
  return { linked: paths.slice(1), ...(paths[0] === undefined ? {} : { primary: paths[0] }) }
}

async function readLaunchAgent(linkedWorktrees: readonly string[]): Promise<WatchmanFacts['launchAgent']> {
  if (Platform.hostPlatform !== 'darwin') {
    return undefined
  }
  const plist = FS.resolvePath(LAUNCH_AGENT_PATH, FS.homeDir())
  if (!await FS.isFile(plist)) {
    return undefined
  }
  const program = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/
    .exec(await FS.readText(plist))?.[1]
  if (program === undefined) {
    return undefined
  }
  const linkedWorktree = linkedWorktrees.find(worktree => FS.pathIsWithin(program, worktree))
  return {
    program,
    programPresent: await FS.exists(program),
    ...(linkedWorktree === undefined ? {} : { linkedWorktree }),
  }
}

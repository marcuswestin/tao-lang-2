import * as Errors from './core/Errors'
import * as Platform from './Platform'

/**
 * A child's lifetime relative to the process that started it.
 *
 * `'dies-with-parent'` links the child to this process through a private descriptor: when this
 * process exits for any reason, a clean quit, a crash, or SIGKILL, the kernel closes the descriptor
 * and the link stops the child's whole process group. `{ outlivesParent }` is the explicit opt-out,
 * and it carries the reason the child is meant to survive, so a survivor is always a decision
 * someone wrote down rather than a default nobody chose.
 */
export type Lifetime = 'dies-with-parent' | { outlivesParent: string }

/** Exit codes the launcher shell reserves for a child that never reached the requested executable. */
export const EXIT_CODES = {
  /** The admission token never arrived: the parent died or refused before the child could start. */
  admissionRefused: 70,
  /** The token that arrived was not the one this launch expected. */
  admissionMismatch: 71,
} as const

/** A spawned child whose descriptor 3 is the private lifetime channel. */
export type LinkedChild = ReturnType<typeof Platform.spawn>

/**
 * How long the link gives a child to honor SIGTERM once its parent is gone before SIGKILL. The
 * stop path a live parent runs has its own, shorter escalation; this one only fires after the
 * parent is already dead, where nothing else will.
 */
export const ORPHAN_KILL_GRACE_SECONDS = 3

/**
 * The launcher runs under `/bin/sh` with descriptor 3 as the only private channel and `"$1"` as
 * the admission token it expects.
 *
 * Admission first: the shell blocks until the parent writes the token, so the parent can record
 * the child's exact kernel identity before anything of the requested command runs. A parent that
 * dies first closes the channel, the read fails, and the executable never starts.
 *
 * Then the link: a background subshell closes the three standard descriptors (so it holds none of
 * the parent's pipes open) and blocks reading descriptor 3. The parent writes `release` when the
 * child has exited on its own, and the watcher leaves. Anything else, which in practice is EOF
 * because the parent is gone, sends SIGTERM and then SIGKILL to the watcher's own process group:
 * the group the launcher leads, since every linked child is started detached. Signalling the group
 * by its own membership rather than by a remembered PID means a reused PID can never be hit, and a
 * `trap` keeps the watcher alive through its own SIGTERM long enough to escalate.
 *
 * Last, `exec` replaces the shell with the requested command, keeping its PID (so the identity the
 * parent recorded stays the identity of the running tool), its argv, and its three standard
 * descriptors, with descriptor 3 closed so the tool and everything it starts inherit no end of the
 * link. A leaked end is the one way the link fails open, and this is the line that prevents it.
 */
export const launcherScript = `IFS= read -r admission <&3 || exit ${EXIT_CODES.admissionRefused}
[ "$admission" = "$1" ] || exit ${EXIT_CODES.admissionMismatch}
shift
(
  exec 0<&- 1>&- 2>&-
  while IFS= read -r line <&3; do
    [ "$line" = release ] && exit 0
  done
  trap '' TERM HUP INT
  kill -TERM 0
  sleep ${ORPHAN_KILL_GRACE_SECONDS}
  kill -KILL 0
) &
exec "$@" 3<&-`

/** The argv name the launcher shell reports, so a process listing says what the shell is doing. */
export const LAUNCHER_NAME = 'tao-process-lifetime'

type StandardStdio = NonNullable<Platform.SpawnOptions['stdio']>
type StdioSlot = Exclude<StandardStdio, string>[number]

/** requireLinkablePlatform refuses a link where no `/bin/sh` process group exists to hold it. */
export function requireLinkablePlatform(platform = Platform.hostPlatform): void {
  if (platform !== 'darwin' && platform !== 'linux') {
    Errors.throwHostEnvironment(`A parent-linked process lifetime is not implemented on ${platform}.`)
  }
}

/**
 * linkedStdio widens the three standard descriptors with the private channel. The link owns the
 * fourth slot; a caller's own auxiliary descriptors or IPC would make its position ambiguous.
 */
export function linkedStdio(stdio: StandardStdio | undefined): StdioSlot[] {
  const resolved = stdio ?? 'pipe'
  const descriptors: StdioSlot[] = typeof resolved === 'string' ? [resolved, resolved, resolved] : [...resolved]
  if (descriptors.length > 3 || descriptors.includes('ipc')) {
    Errors.throwHostEnvironment('A parent-linked lifetime requires the three standard descriptors without IPC.')
  }
  while (descriptors.length < 3) {
    descriptors.push('pipe')
  }
  return [...descriptors, 'pipe']
}

/**
 * spawnLinked starts `command` behind the launcher, detached into its own process group, and hands
 * back the child before admission. The caller records the child's identity, then calls `admit`;
 * until then nothing of `command` has run. Spawn failures surface as the child's `error` event,
 * exactly as `Platform.spawn` reports them.
 */
export function spawnLinked(
  command: string,
  token: string,
  options: {
    args?: readonly string[]
    cwd?: string
    env?: Platform.ProcessEnv
    stdio?: StandardStdio
  } = {},
): LinkedChild {
  requireLinkablePlatform()
  if (token.length === 0 || /[\r\n\0]/u.test(token)) {
    Errors.throwUnexpected('Expected a single-line, non-empty admission token for a linked process.')
  }
  const child = Platform.spawn('/bin/sh', {
    args: ['-c', launcherScript, LAUNCHER_NAME, token, command, ...(options.args ?? [])],
    cwd: options.cwd,
    detached: true,
    env: options.env,
    stdio: linkedStdio(options.stdio),
  })
  const link = linkChannel(child)
  // A watcher that already died with its group makes the parent's later `release` an EPIPE; that
  // is the normal stop path, not an error anyone can act on.
  link?.on('error', () => {})
  if (link !== undefined && 'resume' in link && typeof link.resume === 'function') {
    link.resume()
  }
  return child
}

/** linkChannel is the parent's end of the private channel, or `undefined` when the spawn failed. */
export function linkChannel(child: LinkedChild): NodeJS.WritableStream | undefined {
  const channel = child.stdio[3]
  return channel !== undefined && channel !== null && 'write' in channel
    ? channel as unknown as NodeJS.WritableStream
    : undefined
}

/**
 * admit writes the token so the launcher proceeds to `exec`. It rejects when the channel is gone,
 * which means the launcher already exited (code 70) or the spawn itself failed.
 */
export async function admit(child: LinkedChild, token: string): Promise<void> {
  const link = linkChannel(child)
  if (link === undefined) {
    Errors.throwHostEnvironment('The private process lifetime channel is unavailable; launch refused.')
  }
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error)
    link.once('error', failed)
    link.write(`${token}\n`, error => {
      link.off('error', failed)
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

/**
 * release tells the watcher the child has exited on its own and closes the channel. Called from the
 * child's `exit` handler; a watcher the stop path already killed is not listening, and the write
 * error that produces is swallowed on the channel.
 */
export function release(child: LinkedChild): void {
  const link = linkChannel(child)
  if (link === undefined) {
    return
  }
  try {
    link.end('release\n')
  } catch {
    // The channel is already closed; the watcher is gone either way.
  }
}

/** destroyChannel drops the parent's end without a release, for a launch that is being rolled back. */
export function destroyChannel(child: LinkedChild): void {
  const link = child.stdio[3]
  if (link !== undefined && link !== null) {
    link.destroy()
  }
}

/**
 * requireConsistentLifetime refuses the two spellings that contradict each other: a child that is
 * meant to outlive its parent but was never told why, and one that both dies with the parent and is
 * released from the parent's event loop.
 */
export function requireConsistentLifetime(command: string, lifetime: Lifetime | undefined, unref: boolean): void {
  if (unref && (lifetime === undefined || lifetime === 'dies-with-parent')) {
    Errors.throwUnexpected(
      `Expected '${command}' to declare lifetime: { outlivesParent: <reason> } alongside unref,`
        + ' so a child that survives this process is a recorded decision.',
    )
  }
  if (lifetime !== undefined && lifetime !== 'dies-with-parent') {
    if (typeof lifetime.outlivesParent !== 'string' || lifetime.outlivesParent.trim().length === 0) {
      Errors.throwUnexpected(`Expected a reason in lifetime: { outlivesParent } for '${command}'.`)
    }
  }
}

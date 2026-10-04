/** The fixed metadata descendant the source downloader child spawns, chosen once for both the child and its test. */
import { Platform } from '@shared'

/**
 * Real `plutil` on macOS models the downloader's actual ancestry; elsewhere `cat` stands in with the same lifecycle
 * the barrier must capture and drain: a read-only descendant that blocks on stdin and exits 0 at its end.
 */
export const metadataTool = Platform.hostPlatform === 'darwin'
  ? { path: '/usr/bin/plutil', args: ['-lint', '-'], command: 'plutil' }
  : { path: '/bin/cat', args: [], command: 'cat' }

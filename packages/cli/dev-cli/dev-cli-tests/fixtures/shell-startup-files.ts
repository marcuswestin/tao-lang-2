import { FS } from '@shared'
import { mkTestDir, Test } from '@shared/test'

/**
 * An agent sandbox refuses writes to shell startup files such as `.zshrc` anywhere on disk, scratch
 * copies included, so a suite whose fixtures write one cannot run there. It still runs on the host and
 * inside landing, where the write succeeds.
 */
async function shellStartupFilesWritable(): Promise<boolean> {
  const probe = await mkTestDir('shell-startup-probe-')
  try {
    await FS.writeText(FS.resolvePath('.zshrc', probe), '# probe\n')
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return false
    }
    throw error
  } finally {
    await FS.remove(probe)
  }
}

/** `Test` where shell startup files can be written, and a skipped test where a sandbox refuses them. */
export const ShellStartupFileTest = await shellStartupFilesWritable() ? Test : Test['skip']

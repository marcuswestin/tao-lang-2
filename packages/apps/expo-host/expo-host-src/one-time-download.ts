import { HCI, Platform } from '@shared'
import type { Readable, Writable } from 'node:stream'

/**
 * OneTimeDownload asks before an installed Tao downloads something once per version: the Expo
 * host's packages, and the Node `tao test` runs Jest under. The Developer decided the first such
 * download asks first. A terminal gets the question; anything else needs `TAO_HOST_INSTALL=yes`,
 * which approves this version's host downloads ahead of time, and is told so rather than left
 * waiting on a prompt nobody can answer.
 */

/** CONSENT_ENV approves this version's one-time host downloads for a run with no terminal. */
const CONSENT_ENV = 'TAO_HOST_INSTALL'

/** OneTimeDownload owns asking before a version's one-time downloads. */
export const OneTimeDownload = {
  CONSENT_ENV,
  approve,
  refusalMessage,
} as const

/** DownloadPromptOptions are the terminal a question uses, and the environment consent is read from. */
export type DownloadPromptOptions = {
  environment?: Record<string, string | undefined>
  input?: Readable
  interactive?: boolean
  output?: Writable
}

/** approve reports whether the download described by `question` may go ahead. */
async function approve(question: string, options: DownloadPromptOptions): Promise<boolean> {
  if ((options.environment ?? Platform.runtimeProcess.env)[CONSENT_ENV] === 'yes') {
    return true
  }
  if (!HCI.isInteractive(options)) {
    return false
  }
  return await HCI.askConfirm({ ...options, defaultValue: true, message: question })
}

/** refusalMessage tells a run that could not ask how to approve the download next time. */
function refusalMessage(what: string): string {
  return `Tao needs to download ${what} first. Run the command again in a terminal to approve it, `
    + `or set ${CONSENT_ENV}=yes to approve it ahead of time.`
}

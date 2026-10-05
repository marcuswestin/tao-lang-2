import { Errors, FS } from '@shared'
import { validateMergeMessage } from '@verification/MergeWithMain'

const DRAFT_PREFIX = 'DRAFT: '

/** ReviewedMergeMessage is the reviewed merge message split the way a pull request carries it. */
export type ReviewedMergeMessage = { body: string; title: string }

/**
 * reviewedMergeMessage reads the message an author reviewed at `finalize`'s path,
 * `.artifacts/merge/<branch>.msg`, held to the shape `land` requires, and refuses a mechanical
 * `DRAFT:` exactly as `land` does. A pull request's title and description are this message, and
 * GitHub squash-merges with the pull request's title and description, so it is what reaches `main`.
 */
export async function reviewedMergeMessage(
  dependencies: { exists: (path: string) => Promise<boolean>; readText: (path: string) => Promise<string> },
  root: string,
  branch: string,
): Promise<ReviewedMergeMessage> {
  const messageFile = FS.resolvePath(`.artifacts/merge/${branch}.msg`, root)
  if (!await dependencies.exists(messageFile)) {
    Errors.throwUserInput(`Write and review the merge message first: ${messageFile}`)
  }
  const message = validateMergeMessage(await dependencies.readText(messageFile))
  if (message.startsWith(DRAFT_PREFIX)) {
    Errors.throwUserInput(`Review the drafted merge message and remove its '${DRAFT_PREFIX}' prefix: ${messageFile}`)
  }
  const [title = '', , ...body] = message.split('\n')
  return { body: body.join('\n'), title }
}

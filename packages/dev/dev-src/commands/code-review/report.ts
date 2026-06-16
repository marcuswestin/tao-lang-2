import { FS } from '@shared'
import { capText } from './cap-text'
import type { ReviewMeta } from './types'

/** formatFanoutReport renders a one-line-per-reviewer status table. */
export function formatFanoutReport(metas: readonly ReviewMeta[]): string {
  if (metas.length === 0) {
    return 'no reviewers launched\n'
  }
  const lines = [`launched ${metas.length} reviewer(s):`]
  for (const meta of metas) {
    lines.push(`- ${formatMetaLine(meta)}`)
  }
  const unsuccessful = metas.filter(meta => !isUsableReview(meta)).length
  lines.push(
    unsuccessful === 0 ? 'all reviewers completed' : `${unsuccessful} reviewer(s) failed or returned empty output`,
  )
  return `${lines.join('\n')}\n`
}

export function formatMetaLine(meta: ReviewMeta): string {
  const model = meta.model === undefined ? '' : `/${meta.model}`
  const lens = meta.lens === undefined ? '' : ` [${meta.lens}]`
  const seconds = (meta.durationMs / 1_000).toFixed(1)
  return `${meta.label}: ${meta.reviewer}${model}${lens} ${meta.status} in ${seconds}s, ${meta.bytes}b -> ${meta.reviewPath}`
}

export function isUsableReview(meta: ReviewMeta): boolean {
  return meta.status === 'ok'
}

/** buildReviewDigest renders a capped markdown digest for reviewer outputs. */
export async function buildReviewDigest(
  metas: readonly ReviewMeta[],
  maxBytes: number,
): Promise<{ markdown: string; index: string[] }> {
  const index = metas.map(meta => formatMetaLine(meta))
  const sections: string[] = ['# Review digest', '', '## Reviewers', ...index.map(line => `- ${line}`), '']
  for (const meta of metas) {
    const body = await FS.exists(meta.reviewPath) ? await FS.readText(meta.reviewPath) : ''
    const capped = capText(body.trim(), maxBytes)
    const heading = `## ${meta.label} (${meta.reviewer}${meta.model === undefined ? '' : `/${meta.model}`}${
      meta.lens === undefined ? '' : `, ${meta.lens}`
    })`
    const note = capped.truncated ? ` — truncated from ${capped.originalBytes} bytes` : ''
    sections.push(heading + note, '', capped.text.length > 0 ? capped.text : '_(no output)_', '')
  }
  return { markdown: `${sections.join('\n').trimEnd()}\n`, index }
}

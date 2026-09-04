// Studio agent chat: how a model that has never seen Tao looks something up.
//
// `Docs/Spec/` is the authoritative account of what the toolchain implements today, so it is what the model
// is given — by heading, in bounded pieces, with the file and heading it came from so the answer can cite it.
// Nothing here paraphrases the spec: a paraphrase is one more thing that can be wrong.

import { FS, Repo } from '@shared'

const SPEC_DIR = 'Docs/Spec'

/**
 * A sentence in the spec that marks something as not implemented. A model reading only the surrounding prose
 * would take a deferred feature for a usable one, so a section carrying any of these is handed over with the
 * warning attached rather than silently.
 */
const DEFERRAL = /\b(deferred|not yet|remain(?:s)? future work|is retired|have not landed|no supported|future work)\b/i

export type SpecSection = {
  file: string
  heading: string
  text: string
  /** True when the section says part of what it describes is not implemented. */
  carriesDeferral: boolean
}

function sectionsOf(file: string, content: string): SpecSection[] {
  const lines = content.split('\n')
  const sections: SpecSection[] = []
  let heading = '(preamble)'
  let body: string[] = []
  const flush = () => {
    const text = body.join('\n').trim()
    if (text !== '') {
      sections.push({ carriesDeferral: DEFERRAL.test(text), file, heading, text })
    }
  }
  for (const line of lines) {
    if (/^#{1,3} /.test(line)) {
      flush()
      heading = line.replace(/^#+\s*/, '')
      body = []
    } else {
      body.push(line)
    }
  }
  flush()
  return sections
}

let cached: SpecSection[] | undefined

/** specSections reads and splits every spec page once per Studio process. */
export async function specSections(): Promise<SpecSection[]> {
  if (cached !== undefined) {
    return cached
  }
  const directory = Repo.resolvePath(SPEC_DIR)
  const entries = (await FS.listDir(directory)).filter(name => name.endsWith('.md'))
  const files = await Promise.all(entries.map(async name => ({
    content: await FS.readText(FS.resolvePath(name, directory)),
    name,
  })))
  cached = files.flatMap(file => sectionsOf(file.name.replace(/\.md$/, ''), file.content))
  return cached
}

function score(section: SpecSection, terms: readonly string[]): number {
  const heading = section.heading.toLowerCase()
  const text = section.text.toLowerCase()
  let total = 0
  for (const term of terms) {
    if (heading.includes(term)) {
      total += 10
    }
    // Occurrences past the first say less and less; a section is not ten times as relevant for saying a word
    // ten times.
    total += Math.min(text.split(term).length - 1, 4)
  }
  return total
}

/** clamp keeps one section inside the budget without cutting mid-line. */
function clamp(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }
  const lines = text.split('\n')
  const kept: string[] = []
  let used = 0
  for (const line of lines) {
    if (used + line.length > limit) {
      break
    }
    kept.push(line)
    used += line.length + 1
  }
  return `${kept.join('\n')}\n…(section continues)`
}

export function findSpec(
  sections: readonly SpecSection[],
  topic: string,
  options: { limit?: number; budget?: number } = {},
): { sections: SpecSection[]; note?: string } {
  const terms = topic.toLowerCase().split(/[^a-z0-9]+/).filter(term => term.length > 2)
  if (terms.length === 0) {
    return { note: 'Name a topic, for example "scenario", "checkbox", "query", or "test".', sections: [] }
  }
  const ranked = sections
    .map(section => ({ score: score(section, terms), section }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 3)
    .map(entry => ({ ...entry.section, text: clamp(entry.section.text, options.budget ?? 1800) }))
  return {
    sections: ranked,
    ...(ranked.length === 0
      ? {
        note:
          `The spec has no section about "${topic}". Do not guess the syntax; look at how this app already does it.`,
      }
      : ranked.some(section => section.carriesDeferral)
      ? {
        note:
          'A section below says part of what it describes is not implemented yet. Do not rely on anything it marks as deferred.',
      }
      : {}),
  }
}

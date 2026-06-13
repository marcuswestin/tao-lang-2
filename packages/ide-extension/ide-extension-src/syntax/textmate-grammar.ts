import { FS } from '@shared'

type TextMatePattern = Record<string, unknown>

type TextMateGrammar = Record<string, unknown> & {
  patterns?: TextMatePattern[]
  repository?: Record<string, unknown>
}

/** writeMergedTaoTextMateGrammar writes the Tao TextMate grammar used by VS Code packaging. */
export async function writeMergedTaoTextMateGrammar(grammarPath: string, overlayPath: string): Promise<void> {
  const grammar = await FS.readJson<TextMateGrammar>(grammarPath)
  const overlay = await FS.readJson<TextMateGrammar>(overlayPath)
  await FS.writeJson(grammarPath, mergeTaoTextMateGrammar(grammar, overlay))
}

/** mergeTaoTextMateGrammar combines Langium's generated grammar with Tao-specific token rules. */
export function mergeTaoTextMateGrammar(grammar: TextMateGrammar, overlay: TextMateGrammar): TextMateGrammar {
  const generatedPatterns = grammar.patterns ?? []
  const overlayPatterns = overlay.patterns ?? []
  const patterns = [
    ...generatedPatterns.filter(isCommentPattern),
    ...generatedPatterns.filter(isKeywordPattern),
    ...overlayPatterns,
    ...generatedPatterns.filter(isPreservedGeneratedPattern),
  ]
  return {
    ...grammar,
    _info: overlay['_info'],
    patterns,
    repository: {
      ...(grammar.repository ?? {}),
      ...(overlay.repository ?? {}),
    },
  }
}

function isCommentPattern(pattern: TextMatePattern): boolean {
  return pattern['include'] === '#comments'
}

function isKeywordPattern(pattern: TextMatePattern): boolean {
  return typeof pattern['name'] === 'string' && pattern['name'].startsWith('keyword.')
}

function isStringPattern(pattern: TextMatePattern): boolean {
  return typeof pattern['name'] === 'string' && pattern['name'].startsWith('string.')
}

function isPreservedGeneratedPattern(pattern: TextMatePattern): boolean {
  return !isCommentPattern(pattern) && !isKeywordPattern(pattern) && !isStringPattern(pattern)
}

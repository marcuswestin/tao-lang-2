import { type Extension, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import type { StudioLanguageHighlight, StudioLanguageHighlightToken } from './StudioHighlight'

const setTextMateHighlight = StateEffect.define<StudioLanguageHighlight>()
const colorPattern = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i

function setHighlight(highlight: StudioLanguageHighlight): StateEffect<StudioLanguageHighlight> {
  return setTextMateHighlight.of(highlight)
}

const textMateDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  provide: field => EditorView.decorations.from(field),
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setTextMateHighlight)) {
        next = buildDecorations(effect.value.tokens, transaction.newDoc.length)
      }
    }
    return next
  },
})

/** StudioTextMateLanguage applies server-side TextMate tokens to CodeMirror source ranges. */
export const StudioTextMateLanguage = {
  extension: textMateDecorationField as Extension,
  setHighlight,
  testing: {
    buildDecorations,
  },
} as const

function buildDecorations(
  tokens: readonly StudioLanguageHighlightToken[],
  documentLength = Number.POSITIVE_INFINITY,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const validTokens = tokens
    .filter(token =>
      token.from >= 0
      && token.from < token.to
      && token.to <= documentLength
      && token.color !== undefined
      && colorPattern.test(token.color)
    )
    .sort((left, right) => left.from - right.from || left.to - right.to)
  for (const token of validTokens) {
    builder.add(token.from, token.to, Decoration.mark({ attributes: { style: `color: ${token.color}` } }))
  }
  return builder.finish()
}

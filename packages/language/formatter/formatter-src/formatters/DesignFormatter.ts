import type { FormatHandlers } from '../formatting'

/** DesignFormatter formats the structured §13 surface and its absorbed flat compatibility form. */
export const DesignFormatter = {
  DesignDeclaration(f) {
    f.visibilityOnOwnLine()
    f.oneSpaceAfter('design')
  },

  // A blank line an author left between design members or entries is kept (at most one), so groups
  // survive formatting and `tao fix`'s move into typed blocks.
  DesignBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.members)
    f.separateIndentedLines(f.node.members, keepOneBlankLine)
  },

  DesignToken(f) {
    f.oneSpaceBeforeProperty('value')
  },

  DesignBundle(f) {
    f.oneSpaceBeforeProperty('spec')
  },

  DesignColorsBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entries)
    f.separateIndentedLines(f.node.entries, keepOneBlankLine)
    f.commaLineList()
  },

  DesignColorEntry(f) {
    f.oneSpaceBeforeProperty('value')
    f.oneSpaceBeforeProperty('family')
  },

  DesignColorFamily(f) {
    f.indentedBraceBlock(f.node.members)
    f.lineSeparatedList(f.node.members)
    f.commaLineList()
  },

  DesignColorFamilyMember(f) {
    f.oneSpaceBeforeProperty('value')
  },

  DesignConditionalColor(f) {
    f.oneSpaceAround('when', 'is', '/', 'not')
  },

  DesignColorAtom() {},

  DesignSizesBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entries)
    f.lineSeparatedList(f.node.entries)
    f.commaLineList()
  },

  DesignSizeEntry(f) {
    f.oneSpaceBeforeProperty('value')
  },

  DesignSizeExpression(f) {
    f.oneSpaceAround('+')
  },

  DesignSizeAtom() {},

  DesignDimension() {},

  DesignTextBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entries)
    f.lineSeparatedList(f.node.entries)
  },

  DesignTextEntry(f) {
    f.oneSpaceBeforeProperty('spec')
  },

  DesignScreensBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entries)
    f.lineSeparatedList(f.node.entries)
    f.commaLineList()
  },

  DesignScreenEntry(f) {
    f.oneSpaceAround('below')
  },

  DesignStylesBlock(f) {
    f.oneSpaceBefore('{')
    f.indentedBraceBlock(f.node.entries)
    f.separateIndentedLines(f.node.entries, keepOneBlankLine)
  },

  DesignStyleEntry(f) {
    f.oneSpaceBeforeProperty('spec')
  },

  DesignValuePath() {},
} satisfies Partial<FormatHandlers>

/** keepOneBlankLine starts each design member on its own line and keeps one blank line above it when the source had one. */
function keepOneBlankLine() {
  return { min: 1, max: 2 }
}

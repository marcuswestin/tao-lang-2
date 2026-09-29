/**
 * TaoFileIcon is the lotus glyph that marks a `.tao` file: five petals with a path winding through
 * them, drawn from the Tao app icon. The IDE extension ships it as SVG files and Studio renders it
 * inline, both from this geometry. Every shape is carved by a mask, so the glyph takes one color.
 */
export const TaoFileIcon = {
  viewBox: '0 0 32 32',
  /** Back to front; each petal's outer stroke carves a gap into the petals behind it. */
  petals: [
    'M16 21Q9.5 12 16 3Q22.5 12 16 21Z',
    'M15 24Q14.3 12.45 3 10Q3.7 21.55 15 24Z',
    'M17 24Q17.7 12.45 29 10Q28.3 21.55 17 24Z',
    'M16 28Q11.7 18.2 1 18.5Q5.3 28.3 16 28Z',
    'M16 28Q20.3 18.2 31 18.5Q26.7 28.3 16 28Z',
  ],
  petalGap: 1.6,
  path: 'M20.5 10.5C14 12.5 13.5 15 17 17.5S17.5 23 13 29',
  pathWidth: 1.8,
  /** Glyph colors for editor chrome, from the app icon's cyan. */
  colors: { dark: '#8bdcea', light: '#1f7a90' },

  /** The standalone 16px SVG document for one color, as the IDE extension ships it. */
  svg(color: string): string {
    const petals = TaoFileIcon.petals.map(petal => `      <path d="${petal}"/>`).join('\n')
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${TaoFileIcon.viewBox}" width="16" height="16">
  <mask id="tao">
    <g fill="#fff" stroke="#000" stroke-width="${TaoFileIcon.petalGap}" stroke-linejoin="round" paint-order="stroke">
${petals}
    </g>
    <path d="${TaoFileIcon.path}" fill="none" stroke="#000" stroke-width="${TaoFileIcon.pathWidth}" stroke-linecap="round"/>
  </mask>
  <rect width="32" height="32" fill="${color}" mask="url(#tao)"/>
</svg>
`
  },
} as const

import { Describe, Expect, Test } from '@shared/test'
import { deriveDesignColors, deriveSchemeColors, luminance } from '../cli-src/create/creation-colors'
import { type CreationPalette, DEFAULT_PALETTE } from '../cli-src/create/creation-plan'

const palettes: readonly (readonly [string, CreationPalette])[] = [
  ['the Notebook starter', DEFAULT_PALETTE],
  ['a dark canvas', { canvas: '#101612', ink: '#edf3ee', accent: '#8fbea0' }],
  ['a pale ink close to its canvas', { canvas: '#ffffff', ink: '#6b6b6b', accent: '#3f6f9a' }],
]

Describe('tao create colors', () => {
  for (const [name, palette] of palettes) {
    Test(`muted ink on ${name} reads at WCAG AA on canvas and surface, and stays lighter than ink`, () => {
      const colors = deriveDesignColors(palette)

      Expect(contrast(colors.inkMuted, colors.canvas)).toBeGreaterThanOrEqual(4.5)
      Expect(contrast(colors.inkMuted, colors.surface)).toBeGreaterThanOrEqual(4.5)
      Expect(contrast(colors.inkMuted, colors.canvas)).toBeLessThan(contrast(colors.ink, colors.canvas))
    })

    Test(`${name} gets a light and a dark scheme whose ink, muted ink, and danger read at WCAG AA`, () => {
      const { dark, light } = deriveSchemeColors(palette)

      Expect(luminance(rgb(light.canvas))).toBeGreaterThan(0.5)
      Expect(luminance(rgb(dark.canvas))).toBeLessThan(0.5)
      for (const colors of [light, dark]) {
        for (const background of [colors.canvas, colors.surface]) {
          Expect(contrast(colors.ink, background)).toBeGreaterThanOrEqual(4.5)
          Expect(contrast(colors.inkMuted, background)).toBeGreaterThanOrEqual(4.5)
          Expect(contrast(colors.danger, background)).toBeGreaterThanOrEqual(4.5)
        }
      }
      Expect(contrast(dark.accentStrong, dark.canvas)).toBeGreaterThanOrEqual(4.5)
      Expect(contrast(dark.onAccent, dark.accentStrong)).toBeGreaterThanOrEqual(4.5)
    })
  }

  Test('keep the authored palette as the scheme it was chosen in', () => {
    Expect(deriveSchemeColors(DEFAULT_PALETTE).light).toEqual(deriveDesignColors(DEFAULT_PALETTE))
    const night = { canvas: '#101612', ink: '#edf3ee', accent: '#8fbea0' }
    Expect(deriveSchemeColors(night).dark).toEqual(deriveDesignColors(night))
  })
})

/** contrast is the WCAG ratio between two #rrggbb colors, computed independently of the derivation. */
function contrast(first: string, second: string): number {
  const [lighter, darker] = [first, second].map(hex => luminance(rgb(hex))).sort((left, right) => right - left)
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05)
}

function rgb(hex: string): { r: number; g: number; b: number } {
  const value = Number.parseInt(hex.slice(1), 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

import { Describe, Expect, Test } from '@shared/test'
import { deriveDesignColors, luminance } from '../cli-src/create/creation-colors'
import { type CreationPalette, DEFAULT_PALETTE } from '../cli-src/create/creation-plan'

const palettes: readonly (readonly [string, CreationPalette])[] = [
  ['the Notebook starter', DEFAULT_PALETTE],
  ['the Pantry starter', { canvas: '#f7f3ea', ink: '#2b2118', accent: '#b5562a' }],
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
  }
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

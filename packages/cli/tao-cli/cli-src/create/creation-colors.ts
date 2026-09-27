import type { CreationPalette } from './creation-plan'

/** DesignColors is the full token set a design block declares, derived from a three-color palette. */
export type DesignColors = {
  canvas: string
  surface: string
  ink: string
  inkMuted: string
  accent: string
  accentStrong: string
  accentSoft: string
  line: string
  danger: string
  dangerSoft: string
  onAccent: string
}

/** SchemeColors is the token set for each scheme a generated design follows. */
export type SchemeColors = { light: DesignColors; dark: DesignColors }

type Rgb = { r: number; g: number; b: number }

const BLACK: Rgb = { r: 0, g: 0, b: 0 }
const WHITE: Rgb = { r: 255, g: 255, b: 255 }

/** MIN_TEXT_CONTRAST is WCAG AA's minimum contrast ratio for body-size text. */
const MIN_TEXT_CONTRAST = 4.5

/**
 * deriveDesignColors expands canvas, ink, and accent into every token the generated design uses, so a
 * model or an image supplies three colors and the rest stay coherent with them.
 */
export function deriveDesignColors(palette: CreationPalette): DesignColors {
  const canvas = parseHex(palette.canvas)
  const ink = parseHex(palette.ink)
  const accent = parseHex(palette.accent)
  const lightCanvas = luminance(canvas) > 0.5
  const surface = lightCanvas ? WHITE : mix(canvas, WHITE, 0.08)
  // On a dark canvas the strong accent is lighter than the accent, so as text it stands out more and
  // as a button it carries the canvas as its label.
  const accentStrong = rounded(lightCanvas ? mix(accent, ink, 0.25) : mix(accent, WHITE, 0.25))
  return {
    canvas: formatHex(canvas),
    surface: formatHex(surface),
    ink: formatHex(ink),
    inkMuted: formatHex(mutedInk(ink, canvas, [canvas, surface])),
    accent: formatHex(accent),
    accentStrong: formatHex(accentStrong),
    accentSoft: formatHex(mix(accent, surface, 0.82)),
    line: formatHex(mix(ink, canvas, 0.85)),
    danger: lightCanvas ? '#a43d3d' : '#ef9189',
    dangerSoft: lightCanvas ? '#f8e6e3' : formatHex(mix({ r: 164, g: 61, b: 61 }, canvas, 0.7)),
    onAccent: lightCanvas
      ? luminance(accent) > 0.45 ? formatHex(ink) : '#ffffff'
      : contrastRatio(canvas, accentStrong) >= MIN_TEXT_CONTRAST
      ? formatHex(canvas)
      : '#ffffff',
  }
}

/**
 * deriveSchemeColors expands the palette for the scheme it was chosen in and derives its counterpart
 * for the other, so a generated app follows the person's light or dark setting. The counterpart swaps
 * the palette's canvas and ink, deepening or lifting the new canvas away from the old ink, and moves
 * the accent the same way so it keeps its contrast on the new canvas.
 */
export function deriveSchemeColors(palette: CreationPalette): SchemeColors {
  const canvas = parseHex(palette.canvas)
  const ink = parseHex(palette.ink)
  const accent = parseHex(palette.accent)
  const lightCanvas = luminance(canvas) > 0.5
  const counterpart = deriveDesignColors({
    canvas: formatHex(counterpartCanvas(ink, lightCanvas)),
    ink: formatHex(canvas),
    accent: formatHex(mix(accent, lightCanvas ? WHITE : BLACK, 0.3)),
  })
  const authored = deriveDesignColors(palette)
  return lightCanvas ? { light: authored, dark: counterpart } : { light: counterpart, dark: authored }
}

/**
 * counterpartCanvas moves the palette's ink at least 30% toward black for a dark canvas, or toward
 * white for a light one, and further until it is as deep or as pale as a canvas needs to be for text
 * and danger to read at WCAG AA, so a pale ink cannot leave a grey dark scheme.
 */
function counterpartCanvas(ink: Rgb, towardDark: boolean): Rgb {
  const target = towardDark ? BLACK : WHITE
  for (let amount = 0.3; amount < 1; amount += 0.05) {
    const candidate = rounded(mix(ink, target, amount))
    if (towardDark ? luminance(candidate) <= 0.02 : luminance(candidate) >= 0.85) {
      return candidate
    }
  }
  return target
}

/**
 * mutedInk is the lightest blend of ink toward canvas, at most 45%, whose rounded color still reaches
 * WCAG AA text contrast on every background muted text sits on. A fixed 45% blend read at about 3.5:1
 * on both starters' canvas and surface. A palette whose own ink misses AA keeps that ink.
 */
function mutedInk(ink: Rgb, canvas: Rgb, backgrounds: readonly Rgb[]): Rgb {
  for (let percent = 45; percent > 0; percent--) {
    const candidate = rounded(mix(ink, canvas, percent / 100))
    if (backgrounds.every(background => contrastRatio(candidate, background) >= MIN_TEXT_CONTRAST)) {
      return candidate
    }
  }
  return ink
}

/** contrastRatio is the WCAG contrast ratio between two colors, from 1 to 21. */
function contrastRatio(first: Rgb, second: Rgb): number {
  const firstLuminance = luminance(first)
  const secondLuminance = luminance(second)
  return (Math.max(firstLuminance, secondLuminance) + 0.05) / (Math.min(firstLuminance, secondLuminance) + 0.05)
}

/** parseHex reads a #rrggbb color; the plan validator has already rejected other spellings. */
function parseHex(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

export function formatHex(color: Rgb): string {
  return `#${[color.r, color.g, color.b].map(channel => clamp(channel).toString(16).padStart(2, '0')).join('')}`
}

/** mix blends `from` toward `to` by `amount` in 0..1. */
function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  return {
    r: from.r + (to.r - from.r) * amount,
    g: from.g + (to.g - from.g) * amount,
    b: from.b + (to.b - from.b) * amount,
  }
}

/** luminance is the relative luminance in 0..1 used to decide light or dark treatment. */
export function luminance(color: Rgb): number {
  const channel = (value: number) => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b)
}

/** saturation is the HSL saturation in 0..1, used to pick an accent out of an image. */
export function saturation(color: Rgb): number {
  const max = Math.max(color.r, color.g, color.b) / 255
  const min = Math.min(color.r, color.g, color.b) / 255
  const lightness = (max + min) / 2
  if (max === min) {
    return 0
  }
  return lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min)
}

/** rounded snaps a blended color to the integer channels `formatHex` writes. */
function rounded(color: Rgb): Rgb {
  return { r: clamp(color.r), g: clamp(color.g), b: clamp(color.b) }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

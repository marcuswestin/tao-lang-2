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

type Rgb = { r: number; g: number; b: number }

/**
 * deriveDesignColors expands canvas, ink, and accent into every token the generated design uses, so a
 * model or an image supplies three colors and the rest stay coherent with them.
 */
export function deriveDesignColors(palette: CreationPalette): DesignColors {
  const canvas = parseHex(palette.canvas)
  const ink = parseHex(palette.ink)
  const accent = parseHex(palette.accent)
  const lightCanvas = luminance(canvas) > 0.5
  const surface = lightCanvas ? { r: 255, g: 255, b: 255 } : mix(canvas, { r: 255, g: 255, b: 255 }, 0.08)
  return {
    canvas: formatHex(canvas),
    surface: formatHex(surface),
    ink: formatHex(ink),
    inkMuted: formatHex(mix(ink, canvas, 0.45)),
    accent: formatHex(accent),
    accentStrong: formatHex(lightCanvas ? mix(accent, ink, 0.25) : mix(accent, surface, 0.25)),
    accentSoft: formatHex(mix(accent, surface, 0.82)),
    line: formatHex(mix(ink, canvas, 0.85)),
    danger: '#a43d3d',
    dangerSoft: lightCanvas ? '#f8e6e3' : formatHex(mix({ r: 164, g: 61, b: 61 }, canvas, 0.7)),
    onAccent: luminance(accent) > 0.45 ? formatHex(ink) : '#ffffff',
  }
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

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)))
}

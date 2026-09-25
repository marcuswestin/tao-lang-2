import { AST } from '@parser'

const visualHeads = [
  'background',
  'bg',
  'border',
  'fg',
  'ink',
  'line',
  'radius',
  'size',
  'weight',
] as const

const colorHeads = ['background', 'bg', 'border', 'fg', 'ink'] as const

/** Layout entry heads; `packages/apps/runtime/TaoRuntime-src/TR-design.ts` keeps `layoutHeads` as its mirror. */
const layoutHeads = [
  'aligned',
  'centered',
  'claim',
  'compress',
  'content',
  'fill',
  'gap',
  'height',
  'hug',
  'margin',
  'pad',
  'rigid',
  'width',
] as const

const styleValueHeads = new Set<string>([...visualHeads, 'gap', 'height', 'margin', 'pad', 'width'])

/**
 * isInlineDesignExploration is true only for a raw unnamed nonzero number or hex on a style key.
 * `pad 0` stays an ordinary "set to zero" and `none` stays the clearing keyword (never a string
 * starting with `#`), so neither counts toward the release lint (Decisions §R9).
 */
function isInlineDesignExploration(values: readonly (number | string)[]): boolean {
  const head = values[0]
  return typeof head === 'string'
    && styleValueHeads.has(head)
    && values.slice(1).some(value =>
      (typeof value === 'number' && value !== 0) || (typeof value === 'string' && value.startsWith('#'))
    )
}

/** canonicalVisualHead maps decided source aliases onto the current runtime ABI. */
function canonicalVisualHead(head: string): string {
  return head === 'background' ? 'bg' : head === 'ink' ? 'fg' : head
}

/** standardElementName returns the published @tao/ui element name for one linked render. */
function standardElementName(render: AST.Render): string | undefined {
  const view = render.view?.ref
  if (!AST.isViewDeclaration(view) || !/^[A-Z][A-Za-z0-9_]*$/.test(view.name)) {
    return undefined
  }
  const path = AST.getDocument(view).uri.path
  return path.includes('/@tao/ui/') ? view.name : undefined
}

export const design = {
  canonicalVisualHead,
  colorHeads,
  isInlineDesignExploration,
  layoutHeads,
  standardElementName,
  visualHeads,
} as const

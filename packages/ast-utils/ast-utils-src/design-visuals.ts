/** Shared design vocabulary keeps validation, codegen, and Studio release gates in lockstep. */
export const designVisualHeads = [
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

export const designColorHeads = ['background', 'bg', 'border', 'fg', 'ink'] as const

/** Layout entry heads; `packages/runtime/TaoRuntime-src/TR-design.ts` keeps `layoutHeads` as its mirror. */
export const designLayoutHeads = [
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

/** canonicalDesignVisualHead maps decided source aliases onto the current runtime ABI. */
export function canonicalDesignVisualHead(head: string): string {
  return head === 'background' ? 'bg' : head === 'ink' ? 'fg' : head
}

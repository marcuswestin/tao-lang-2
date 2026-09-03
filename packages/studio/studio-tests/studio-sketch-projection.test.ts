import { Describe, Expect, Test } from '@shared/test'
import type { StudioSketchRect } from '../studio-src/StudioSketchCatalog'
import {
  StudioSketchProjection,
  type StudioSketchProjectionInput,
  type StudioSketchProjectionNode,
} from '../studio-src/StudioSketchProjection'
import corpusJson from './fixtures/sketch-projection-corpus.json'

type CorpusEntry =
  & StudioSketchProjectionInput
  & Readonly<{
    expectedTree: string
    name: string
    needsOverlay: boolean
  }>

const corpus = corpusJson as readonly CorpusEntry[]

Describe('Studio sketch projection corpus', () => {
  Test('pins 16 component-scale layouts to canonical trees and overlay decisions', () => {
    Expect(corpus).toHaveLength(16)
    for (const sample of corpus) {
      const result = StudioSketchProjection.project(sample)
      Expect({
        name: sample.name,
        needsOverlay: result.needsOverlay,
        tree: StudioSketchProjection.signature(result.tree),
      }).toEqual({ name: sample.name, needsOverlay: sample.needsOverlay, tree: sample.expectedTree })
    }
  })

  Test('reports the engine-derived direct-projection rate without claiming screen-corpus acceptance', () => {
    const direct = corpus.filter(sample => !StudioSketchProjection.project(sample).needsOverlay)
    Expect({ accepted: direct.length, corpus: corpus.length, rate: direct.length / corpus.length }).toEqual({
      accepted: 12,
      corpus: 16,
      rate: 0.75,
    })
  })
})

Describe('Studio sketch projection invariants', () => {
  Test('is independent of input order and stable across repeated projection', () => {
    const sample = corpus.find(entry => entry.name === 'playlist-row')!
    const expected = projectSignature(sample)
    Expect(projectSignature({ ...sample, rects: [...sample.rects].reverse() })).toBe(expected)
    Expect(projectSignature(sample)).toBe(expected)
  })

  Test('preserves every identity exactly once across deterministic corpus permutations', () => {
    for (const sample of corpus) {
      const expected = projectSignature(sample)
      for (let offset = 0; offset < sample.rects.length; offset += 1) {
        const rotated = [...sample.rects.slice(offset), ...sample.rects.slice(0, offset)]
        Expect(projectSignature({ ...sample, rects: rotated })).toBe(expected)
        const ids = elements(StudioSketchProjection.project({ ...sample, rects: rotated }).tree).map(node => node.id)
        Expect([...ids].sort()).toEqual(sample.rects.map(rect => rect.id).sort())
      }
    }
  })

  Test('chooses a clean axis, nests the other lane, and uses median neighbour distance', () => {
    const result = StudioSketchProjection.project({
      height: 100,
      width: 300,
      rects: [
        rect('left', 'Box', 10, 10, 40, 80),
        rect('top', 'Text', 70, 10, 100, 20),
        rect('bottom', 'Text', 70, 40, 100, 20),
        rect('right', 'Box', 210, 10, 40, 80),
      ],
    })
    Expect(result.needsOverlay).toBe(false)
    Expect(StudioSketchProjection.signature(result.tree)).toBe(
      'Row(gap=30,pad=10/50/10/10)[left:Box(40x80),Col(gap=10,pad=0/0/0/0,claim=1)[top:Text(hugxhug),bottom:Text(hugxhug)],right:Box(40x80)]',
    )
  })

  Test('retains fixed boxes, hugs text and images, fills boxes touching opposite sketch edges', () => {
    const result = StudioSketchProjection.project({
      height: 100,
      width: 200,
      rects: [
        rect('fill', 'Box', 0, 0, 200, 20),
        rect('text', 'Text', 10, 40, 80, 20),
        rect('image', 'Image', 110, 40, 40, 40),
        rect('fixed', 'Box', 10, 90, 30, 10),
      ],
    })
    const leaves = elements(result.tree)
    Expect(leaves.find(leaf => leaf.id === 'fill')).toMatchObject({ height: 20, width: 'fill' })
    Expect(leaves.find(leaf => leaf.id === 'text')).toMatchObject({ height: 'hug', width: 'hug' })
    Expect(leaves.find(leaf => leaf.id === 'image')).toMatchObject({ height: 'hug', width: 'hug' })
    Expect(leaves.find(leaf => leaf.id === 'fixed')).toMatchObject({ height: 10, width: 30 })
  })

  Test('retains sketch-edge padding for a single rectangle', () => {
    const result = StudioSketchProjection.project({
      height: 80,
      rects: [rect('only', 'Box', 12, 8, 100, 40)],
      width: 140,
    })
    Expect(StudioSketchProjection.signature(result.tree)).toBe(
      'Col(gap=0,pad=8/28/32/12)[only:Box(100x40)]',
    )
  })

  Test('marks overlap for canonical proposal instead of direct application', () => {
    const input = corpus.find(entry => entry.name === 'badge-overlap')!
    const first = StudioSketchProjection.project(input)
    const second = StudioSketchProjection.project({ ...input, rects: [...input.rects].reverse() })
    Expect(first.needsOverlay).toBe(true)
    Expect(StudioSketchProjection.signature(second.tree)).toBe(StudioSketchProjection.signature(first.tree))
  })

  Test('marks a two-clean-axis grid as ambiguous even though its canonical proposal is deterministic', () => {
    const input = corpus.find(entry => entry.name === 'card-grid')!
    const result = StudioSketchProjection.project(input)

    Expect(result.needsOverlay).toBe(true)
    Expect(StudioSketchProjection.signature(result.tree)).toBe(input.expectedTree)
  })

  Test('rejects duplicate identities, empty sets, and invalid geometry', () => {
    Expect(() => StudioSketchProjection.project({ height: 10, rects: [], width: 10 })).toThrow()
    Expect(() =>
      StudioSketchProjection.project({
        height: 10,
        rects: [rect('same', 'Box', 0, 0, 1, 1), rect('same', 'Box', 2, 2, 1, 1)],
        width: 10,
      })
    ).toThrow()
    Expect(() =>
      StudioSketchProjection.project({
        height: 10,
        rects: [rect('bad', 'Box', 0, 0, Number.NaN, 1)],
        width: 10,
      })
    ).toThrow()
  })
})

function projectSignature(input: StudioSketchProjectionInput): string {
  return StudioSketchProjection.signature(StudioSketchProjection.project(input).tree)
}

function rect(
  id: string,
  kind: string,
  x: number,
  y: number,
  width: number,
  height: number,
): StudioSketchRect {
  return { height, id, kind, width, x, y }
}

function elements(
  node: StudioSketchProjectionNode,
): readonly Extract<StudioSketchProjectionNode, { type: 'element' }>[] {
  return node.type === 'element' ? [node] : node.children.flatMap(elements)
}

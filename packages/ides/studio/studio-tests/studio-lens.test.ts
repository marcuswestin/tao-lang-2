import { Errors } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StudioLens, type StudioLensStorage } from '../studio-src/client/StudioLens'
import {
  createStudioSourceAnalyzer,
  isStudioLensCycleShortcut,
  StudioLensBar,
} from '../studio-src/product-host/StudioEditorSurface'

function fakeStorage(initial: Record<string, string> = {}): StudioLensStorage & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial))
  return {
    getItem: key => items.get(key) ?? null,
    items,
    setItem: (key, value) => {
      items.set(key, value)
    },
  }
}

Describe('Studio lens vocabulary', () => {
  Test('names every facet once with a glyph and recognises the presets by their facet sets', () => {
    Expect(StudioLens.facets.map(facet => facet.name)).toEqual([
      'structure',
      'layout',
      'behavior',
      'data',
      'wiring',
      'tests',
      'comments',
    ])
    Expect(new Set(StudioLens.facets.map(facet => facet.glyph)).size).toBe(StudioLens.facets.length)
    Expect(StudioLens.presetFor(StudioLens.all())?.id).toBe('all')
    Expect(StudioLens.presetFor(['layout', 'structure'])?.id).toBe('style')
    Expect(StudioLens.presetFor([])?.id).toBe('outline')
    Expect(StudioLens.presetFor(['tests'])).toBeUndefined()
  })

  Test('toggles facets in canonical order and cycles through the presets', () => {
    Expect(StudioLens.toggle(['structure'], 'layout')).toEqual(['structure', 'layout'])
    Expect(StudioLens.toggle(['layout', 'structure'], 'structure')).toEqual(['layout'])

    const sequence: string[] = []
    let active = StudioLens.all()
    for (let step = 0; step < StudioLens.presets.length + 1; step++) {
      active = StudioLens.cycle(active)
      sequence.push(StudioLens.presetFor(active)?.id ?? 'custom')
    }
    Expect(sequence).toEqual(['compose', 'style', 'trace', 'data', 'outline', 'all', 'compose'])
    Expect(StudioLens.presetFor(StudioLens.cycle(['tests']))?.id).toBe('all')
  })

  Test('persists the global preference and falls back to every facet on anything unreadable', () => {
    const storage = fakeStorage()
    StudioLens.save(storage, ['behavior', 'data'])
    Expect(JSON.parse(storage.items.get('tao-studio.lens')!)).toEqual({ active: ['behavior', 'data'], version: 1 })
    Expect(StudioLens.load(storage)).toEqual(['behavior', 'data'])

    Expect(StudioLens.load(fakeStorage({ 'tao-studio.lens': 'not json' }))).toEqual(StudioLens.all())
    Expect(StudioLens.load(fakeStorage({ 'tao-studio.lens': '{"version":2,"active":[]}' }))).toEqual(StudioLens.all())
    Expect(StudioLens.load(fakeStorage({ 'tao-studio.lens': '{"version":1,"active":["data","bogus"]}' }))).toEqual([
      'data',
    ])
    Expect(StudioLens.load(undefined)).toEqual(StudioLens.all())
  })

  Test('recognises Shift+Alt+L as the preset cycle shortcut', () => {
    const base = { altKey: true, code: 'KeyL', ctrlKey: false, key: 'Ò', metaKey: false, shiftKey: true }
    Expect(isStudioLensCycleShortcut(base)).toBe(true)
    Expect(isStudioLensCycleShortcut({ ...base, code: '', key: 'l' })).toBe(true)
    Expect(isStudioLensCycleShortcut({ ...base, metaKey: true })).toBe(false)
    Expect(isStudioLensCycleShortcut({ ...base, shiftKey: false })).toBe(false)
    Expect(isStudioLensCycleShortcut({ ...base, code: 'KeyK', key: 'k' })).toBe(false)
  })

  Test('renders the lens bar with the matching preset and facet states pressed', () => {
    const html = renderToStaticMarkup(
      React.createElement(StudioLensBar, { active: ['structure', 'layout'], onChange: () => {}, onRefold: () => {} }),
    )

    Expect(html).toContain('data-preset="style"')
    Expect(html).toContain('aria-pressed="true" class="studio-lens-preset" data-testid="studio-lens-preset-style"')
    Expect(html).toContain('aria-pressed="false" class="studio-lens-preset" data-testid="studio-lens-preset-compose"')
    Expect(html).toContain('aria-pressed="true" class="studio-lens-facet" data-testid="studio-lens-facet-layout"')
    Expect(html).toContain('aria-pressed="false" class="studio-lens-facet" data-testid="studio-lens-facet-behavior"')
    Expect(html).toContain('data-testid="studio-lens-refold"')
  })

  Test('retries rejected syntax analysis for unchanged source', async () => {
    let attempts = 0
    const analyze = createStudioSourceAnalyzer(async content => {
      attempts += 1
      if (attempts === 1) {
        Errors.throwHostEnvironment('language service disconnected')
      }
      return { content }
    })

    await Expect(analyze('view Main() { }')).rejects.toThrow('language service disconnected')
    await Expect(analyze('view Main() { }')).resolves.toEqual({ content: 'view Main() { }' })
    Expect(attempts).toBe(2)
  })
})

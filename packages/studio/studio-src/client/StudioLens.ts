/**
 * StudioLens is the browser-safe vocabulary of Studio's syntax lenses: which facets of Tao syntax
 * exist, the glyph each collapses to, the presets that match a way of working, and the one global
 * preference that remembers the active set. The server classifies source into these facets; the
 * editor projects them.
 */

export type StudioLensFacet = 'structure' | 'layout' | 'behavior' | 'data' | 'wiring' | 'tests' | 'comments'

export type StudioLensFacetDefinition = Readonly<{
  glyph: string
  hint: string
  label: string
  name: StudioLensFacet
}>

export type StudioLensPreset = Readonly<{
  facets: readonly StudioLensFacet[]
  id: string
  label: string
}>

export type StudioLensStorage = Pick<Storage, 'getItem' | 'setItem'>

type StudioLensEnvelope = Readonly<{ active: readonly string[]; version: 1 }>

const storageKey = 'tao-studio.lens'

const facets: readonly StudioLensFacetDefinition[] = [
  { glyph: '▢', hint: 'Views, render trees, slots, and render control flow', label: 'Structure', name: 'structure' },
  { glyph: '▦', hint: 'Layout clauses and design declarations', label: 'Layout', name: 'layout' },
  { glyph: '➜', hint: 'Event handlers, actions, commands, and functions', label: 'Behavior', name: 'behavior' },
  { glyph: '▤', hint: 'State, queries, bindings, types, and data', label: 'Data', name: 'data' },
  { glyph: '⌁', hint: 'Imports, app configuration, and injected TypeScript', label: 'Wiring', name: 'wiring' },
  { glyph: '✓', hint: 'Tests, fixtures, scenarios, and tags', label: 'Tests', name: 'tests' },
  { glyph: '¶', hint: 'Comments', label: 'Comments', name: 'comments' },
]

const facetNames: readonly StudioLensFacet[] = facets.map(facet => facet.name)

const presets: readonly StudioLensPreset[] = [
  { facets: facetNames, id: 'all', label: 'All' },
  { facets: ['structure'], id: 'compose', label: 'Compose' },
  { facets: ['structure', 'layout'], id: 'style', label: 'Style' },
  { facets: ['behavior', 'data'], id: 'trace', label: 'Trace' },
  { facets: ['data'], id: 'data', label: 'Data' },
  { facets: [], id: 'outline', label: 'Outline' },
]

export const StudioLens = {
  facets,
  presets,
  /** all is the default: every facet shown, the editor as it always was. */
  all(): readonly StudioLensFacet[] {
    return facetNames
  },
  /** cycle moves to the preset after the one matching `active`, or to the first preset when none matches. */
  cycle(active: readonly StudioLensFacet[]): readonly StudioLensFacet[] {
    const current = presets.findIndex(preset => sameFacets(preset.facets, active))
    const next = presets[(current + 1) % presets.length]
    return next === undefined ? facetNames : next.facets
  },
  /** isFacet narrows one stored or received string to a known facet name. */
  isFacet(value: unknown): value is StudioLensFacet {
    return typeof value === 'string' && facetNames.includes(value as StudioLensFacet)
  },
  /** load restores the global preference, falling back to every facet when nothing valid is stored. */
  load(storage: StudioLensStorage | undefined): readonly StudioLensFacet[] {
    if (storage === undefined) {
      return facetNames
    }
    try {
      const raw = storage.getItem(storageKey)
      if (raw === null) {
        return facetNames
      }
      const parsed: unknown = JSON.parse(raw)
      if (!isEnvelope(parsed)) {
        return facetNames
      }
      return normalize(parsed.active.filter(StudioLens.isFacet))
    } catch {
      return facetNames
    }
  },
  /** presetFor returns the preset whose facet set equals `active`, if any. */
  presetFor(active: readonly StudioLensFacet[]): StudioLensPreset | undefined {
    return presets.find(preset => sameFacets(preset.facets, active))
  },
  /** save persists the global preference; storage failures are ignored because the lens still works for the session. */
  save(storage: StudioLensStorage | undefined, active: readonly StudioLensFacet[]): void {
    if (storage === undefined) {
      return
    }
    try {
      const envelope: StudioLensEnvelope = { active: normalize(active), version: 1 }
      storage.setItem(storageKey, JSON.stringify(envelope))
    } catch {
      // A full or disabled storage only loses persistence, never the lens itself.
    }
  },
  /** toggle flips one facet, keeping facets in their canonical order. */
  toggle(active: readonly StudioLensFacet[], facet: StudioLensFacet): readonly StudioLensFacet[] {
    return normalize(active.includes(facet) ? active.filter(name => name !== facet) : [...active, facet])
  },
} as const

function normalize(active: readonly StudioLensFacet[]): readonly StudioLensFacet[] {
  return facetNames.filter(name => active.includes(name))
}

function sameFacets(left: readonly StudioLensFacet[], right: readonly StudioLensFacet[]): boolean {
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((name, index) => normalizedRight[index] === name)
}

function isEnvelope(value: unknown): value is StudioLensEnvelope {
  return typeof value === 'object'
    && value !== null
    && 'version' in value
    && value.version === 1
    && 'active' in value
    && Array.isArray(value.active)
}

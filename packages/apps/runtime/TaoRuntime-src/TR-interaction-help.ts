import { allocateInteractionKeys } from './TR-interaction-allocation'
import type { TaoAttentionSnapshot } from './TR-interaction-attention'
import type { CommandCatalog } from './TR-interaction-catalog'
import type { InteractionOutline } from './TR-interaction-outline'

export type TaoContextualHelp = Readonly<{
  actions: readonly Readonly<{ description?: string; enabled: boolean; invocation: string; label: string }>[]
  region: string
  target: string
}>

/** Help is generated only for the first mounted narrowing choice. */
export function contextualHelp(
  attention: TaoAttentionSnapshot,
  catalog: CommandCatalog,
  outline: InteractionOutline,
): TaoContextualHelp | undefined {
  if (attention.mode !== 'narrowing' || attention.narrowing.length === 0) {
    return undefined
  }
  const choice = attention.target && attention.candidates.includes(attention.target)
    ? attention.target
    : attention.candidates[0]
  const node = outline.liveNodes().find(candidate => candidate.identity === choice)
  const target = node?.label()
  if (node === undefined || target === undefined) {
    return undefined
  }
  const verbs = catalog.verbsFor(node, outline)
  const assignments = allocateInteractionKeys(
    verbs.filter(verb => verb.key === undefined).map(verb => ({ identity: verb.identity, label: verb.label })),
    { explicitKeys: catalog.explicitKeys() },
  )
  return {
    actions: verbs.map(verb => ({
      ...(verb.description === undefined ? {} : { description: verb.description }),
      enabled: verb.enabled,
      invocation: `. then ${(verb.key ?? assignments[verb.identity] ?? 'Enter').toLocaleUpperCase()}`,
      label: verb.label,
    })),
    region: attention.focusRegionLabel ?? 'Current region',
    target,
  }
}

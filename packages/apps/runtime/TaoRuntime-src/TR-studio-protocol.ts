/** Wire constants shared by the standalone preview runtime and the Studio host. */
export const TaoStudioProtocolVersions = {
  channel: 'tao-studio',
  protocolVersion: 1,
  sourceActionVersion: 2,
} as const

export const taoStudioFeedMime = 'application/x-tao-studio-feed'

export type TaoStudioFeedDrop =
  & Readonly<{ entity: string; rowId: string; path: readonly string[] }>
  & (
    | Readonly<{ kind: 'collection' }>
    | Readonly<{ kind: 'field'; presentation: 'text' | 'image' }>
  )

/** Parses only the bounded semantic payload shared by preview drops and the Studio host. */
export function parseTaoStudioFeedDrop(value: unknown): TaoStudioFeedDrop | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const fields = value as Record<string, unknown>
  const { entity, rowId, path, kind, presentation } = fields
  if (
    typeof entity !== 'string' || entity.length > 256 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(entity)
    || typeof rowId !== 'string' || rowId.length === 0 || rowId.length > 4096
    || !Array.isArray(path) || path.length === 0 || path.length > 32
    || !path.every((part): part is string =>
      typeof part === 'string' && part.length <= 256 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(part)
    )
  ) {
    return undefined
  }
  const base = { entity, rowId, path: [...path] }
  if (kind === 'collection' && Object.keys(fields).every(key => ['entity', 'rowId', 'path', 'kind'].includes(key))) {
    return { ...base, kind }
  }
  return kind === 'field' && (presentation === 'text' || presentation === 'image')
      && Object.keys(fields).every(key => ['entity', 'rowId', 'path', 'kind', 'presentation'].includes(key))
    ? { ...base, kind, presentation }
    : undefined
}

/** Validates the parent bridge payload without trusting any source identity supplied by a drop. */
export function parseTaoStudioFeedDropAtPoint(value: unknown): {
  clientX: number
  clientY: number
  drop: TaoStudioFeedDrop
} | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  const fields = value as Record<string, unknown>
  const { clientX, clientY } = fields
  const drop = parseTaoStudioFeedDrop(fields['drop'])
  return typeof clientX === 'number' && Number.isFinite(clientX)
      && typeof clientY === 'number' && Number.isFinite(clientY) && drop !== undefined
    ? { clientX, clientY, drop }
    : undefined
}

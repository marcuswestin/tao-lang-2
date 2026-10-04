import type { DevLoopMobilePublication } from '@shared/DevLoopControl'

const publicationFields = [
  'session',
  'checkout',
  'loopGeneration',
  'projectRoot',
  'appName',
  'sourceRevision',
  'compiledRevision',
  'nonce',
] as const satisfies readonly (keyof DevLoopMobilePublication)[]

/** One mounted managed publication may hide its in-memory Android development menu once. */
export function createManagedRuntimePreparation() {
  const attempted = new Set<string>()
  return async (
    options: Readonly<{
      development: boolean
      platform: string
      publication: unknown
      resolveNativeMenu: () => { hideMenu?: () => void | Promise<void> } | null
      onFailure: (error: unknown) => void | Promise<void>
    }>,
  ): Promise<void> => {
    if (!options.development || options.platform !== 'android') {
      return
    }
    const publication = options.publication
    if (publication === null || typeof publication !== 'object') {
      return
    }
    const record = publication as Partial<DevLoopMobilePublication>
    if (
      !publicationFields.every(field =>
        Object.prototype.hasOwnProperty.call(record, field)
        && typeof record[field] === 'string' && record[field]!.trim().length > 0
      )
    ) {
      return
    }
    const key = JSON.stringify(publicationFields.map(field => record[field]))
    if (attempted.has(key)) {
      return
    }
    // Latch before native resolution/await: overlapping or repeated effects cannot repeat the action.
    attempted.add(key)
    try {
      const menu = options.resolveNativeMenu()
      if (typeof menu?.hideMenu === 'function') {
        await menu.hideMenu()
      }
    } catch (error) {
      try {
        // Reporting is best effort and must neither reject the root effect nor delay it.
        void Promise.resolve(options.onFailure(error)).catch(() => {})
      } catch { /* A failed warning cannot replace the native failure or repeat preparation. */ }
    }
  }
}

/** Mounted diagnostics remain queryable by native identifier without a screen-reader announcement. */
export function managedLoopIdentityMarker(identity: object, devUrl: string | undefined) {
  return {
    accessible: false,
    focusable: false,
    collapsable: false,
    pointerEvents: 'none' as const,
    testID: `tao-managed-loop-identity.${encodeURIComponent(JSON.stringify({ ...identity, devUrl }))}`,
    style: { position: 'absolute' as const, width: 1, height: 1, opacity: 0.01 },
  }
}

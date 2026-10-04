import { ReleaseCapabilities, type ReleaseCapability } from '@shared'
import * as AST from './parserASTExport'

/** Shared structural classification for release diagnostics and editor suggestions. */
export function releaseCapabilityOf(node: AST.Node): ReleaseCapability {
  const structural = ReleaseCapabilities.syntaxCapability(node.$type)
  if (structural !== 'core') {
    return structural
  }
  if (AST.isEntityDataField(node) && node.traits?.traits.some(trait => trait.reference)) {
    return 'http-data'
  }
  if (AST.isDesignColorAtom(node) && node.path !== undefined) {
    return 'advanced-design'
  }
  if ((AST.isDesignStyleEntry(node) || AST.isDesignBundle(node)) && /^[A-Z]/u.test(node.name)) {
    return 'advanced-design'
  }
  return 'core'
}

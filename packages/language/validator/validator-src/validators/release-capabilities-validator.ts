import { ASTUtils, Type } from '@ast-utils'
import { AST, releaseCapabilityOf } from '@parser'
import { Errors, FS, ReleaseCapabilities, type ReleaseCapability, type ReleaseProfile, ReleaseToolchain } from '@shared'
import type { ValidationContext } from '../validation'

/** Release diagnostics share the same policy wording as public command entry points. */
export const releaseCapabilitiesValidationMessages = {
  unavailable: (capability: ReleaseCapability, profile: ReleaseProfile): string =>
    ReleaseCapabilities.diagnostic(capability, profile),
  toolchain: (error: unknown): string => Errors.messageOf(error),
}

/** Editor builds check each document's nearest project pin, including nested projects. */
export async function validateEditorRelease(file: AST.TaoFile, ctx: ValidationContext): Promise<boolean> {
  const document = AST.getDocument(file)
  if (document.uri.scheme !== 'file' || FS.pathIsWithin(document.uri.path, ctx.packagesContext.stdlibRoot)) {
    return true
  }
  try {
    await ReleaseToolchain.requireMatchingProjectRelease(document.uri.path, 'editor')
    return true
  } catch (error) {
    ctx.error(file, releaseCapabilitiesValidationMessages.toolchain(error), { code: 'release-toolchain' })
    return false
  }
}

/** Check authored source and resolved references, never bundled standard-library implementation. */
export function validateReleaseCapabilities(file: AST.TaoFile, ctx: ValidationContext): void {
  const profile = ctx.releaseProfile ?? ReleaseCapabilities.current()
  if (
    profile.phase === 'development' || FS.pathIsWithin(AST.getDocument(file).uri.path, ctx.packagesContext.stdlibRoot)
  ) {
    return
  }
  for (const app of AST.appValueDeclarationsInFile(file)) {
    for (const [name, slot] of ASTUtils.effectiveAppConfiguration(app)) {
      const capability = ReleaseCapabilities.appSlotCapability(name)
      const source = slot.value ?? slot.block
      if (
        capability !== 'core' && source
        && !FS.pathIsWithin(AST.getDocument(source).uri.path, ctx.packagesContext.stdlibRoot)
        && !ReleaseCapabilities.allows(capability, profile)
      ) {
        ctx.error(source, releaseCapabilitiesValidationMessages.unavailable(capability, profile), {
          code: 'release-capability',
        })
      }
    }
    if (ASTUtils.appBoundDatasources(app).length > 1 && !ReleaseCapabilities.allows('http-data', profile)) {
      ctx.error(app, releaseCapabilitiesValidationMessages.unavailable('http-data', profile), {
        code: 'release-capability',
      })
    }
  }
  const nodes = AST.streamAllContents(file)
  for (const node of nodes) {
    const capabilities = new Set<ReleaseCapability>([releaseCapabilityOf(node)])
    if (AST.isNamedTypeReference(node)) {
      const definition = Type.definitionOfReference(node)
      if (definition) {
        capabilities.add(ReleaseCapabilities.packageCapability(AST.getDocument(definition).uri.path))
      }
    }
    for (const reference of AST.streamReferences(node)) {
      const target = 'ref' in reference.reference ? reference.reference.ref : undefined
      if (target) {
        capabilities.add(
          ReleaseCapabilities.symbolCapability(
            AST.getDocument(target).uri.path,
            'name' in target ? String(target.name) : '',
          ),
        )
      }
    }
    for (const capability of capabilities) {
      if (!ReleaseCapabilities.allows(capability, profile)) {
        ctx.error(node, releaseCapabilitiesValidationMessages.unavailable(capability, profile), {
          code: 'release-capability',
        })
      }
    }
  }
}

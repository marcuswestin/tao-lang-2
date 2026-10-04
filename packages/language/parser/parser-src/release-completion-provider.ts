import { FS, ReleaseCapabilities, type ReleaseProfile, ReleaseToolchain } from '@shared'
import { type AstNodeDescription, GrammarAST } from 'langium'
import type { CompletionContext, DefaultCompletionProvider } from 'langium/lsp'
import { Langium } from './langium-exports'
import * as AST from './parserASTExport'
import { releaseCapabilityOf } from './release-capability'

/** Completion suggestions obey the same release policy as validation; linking stays unrestricted. */
export class ReleaseCompletionProvider extends Langium.DefaultCompletionProvider {
  constructor(
    private readonly releaseServices: Langium.LangiumServices,
    private readonly profile: ReleaseProfile = ReleaseCapabilities.current(),
    private readonly stdlibRoot?: string,
  ) {
    super(releaseServices)
  }

  override async getCompletion(
    ...args: Parameters<DefaultCompletionProvider['getCompletion']>
  ): Promise<Awaited<ReturnType<DefaultCompletionProvider['getCompletion']>>> {
    const [document] = args
    if (document.uri.scheme === 'file' && (!this.stdlibRoot || !FS.pathIsWithin(document.uri.path, this.stdlibRoot))) {
      await ReleaseToolchain.requireMatchingProjectRelease(document.uri.path, 'editor')
    }
    return await super.getCompletion(...args)
  }

  protected override getReferenceCandidates(
    refInfo: Langium.ReferenceInfo,
    context: CompletionContext,
  ): Langium.Stream<AstNodeDescription> {
    const candidates = super.getReferenceCandidates(refInfo, context)
    // Development builds allow every capability, so the declaration walk below could never filter.
    if (this.profile.phase === 'development') {
      return candidates
    }
    return candidates.filter(candidate => {
      if (
        !ReleaseCapabilities.allows(
          ReleaseCapabilities.symbolCapability(candidate.documentUri.path, candidate.name),
          this.profile,
        )
      ) {
        return false
      }
      const document = this.releaseServices.shared.workspace.LangiumDocuments.getDocument(candidate.documentUri)
      const node = candidate.node
        ?? (document
          && this.releaseServices.workspace.AstNodeLocator.getAstNode(document.parseResult.value, candidate.path))
      return !node || this.allowsDeclaration(node as AST.Node, new Set())
    })
  }

  protected override filterKeyword(context: CompletionContext, keyword: GrammarAST.Keyword): boolean {
    let owner: Langium.AstNode | undefined = keyword.$container
    while (owner && !GrammarAST.isParserRule(owner)) {
      owner = owner.$container
    }
    const capability = ReleaseCapabilities.keywordCapability(
      GrammarAST.isParserRule(owner) ? owner.name : '',
      keyword.value,
    )
    return ReleaseCapabilities.allows(capability, this.profile) && super.filterKeyword(context, keyword)
  }

  private allowsDeclaration(node: AST.Node, seen: Set<AST.Node>): boolean {
    if (seen.has(node)) {
      return true
    }
    seen.add(node)
    const path = AST.getDocument(node).uri.path
    if (!ReleaseCapabilities.allows(ReleaseCapabilities.packageCapability(path), this.profile)) {
      return false
    }
    // Standard-library contracts may reference implementation capabilities hidden from authors.
    if (this.stdlibRoot && FS.pathIsWithin(path, this.stdlibRoot)) {
      return true
    }
    for (const child of [node, ...AST.streamAllContents(node)]) {
      if (!ReleaseCapabilities.allows(releaseCapabilityOf(child), this.profile)) {
        return false
      }
      if (
        AST.isAppProperty(child)
        && !ReleaseCapabilities.allows(ReleaseCapabilities.appSlotCapability(child.name), this.profile)
      ) {
        return false
      }
      if (AST.isNamedTypeReference(child)) {
        const target = AST.visibleFileDeclarations(child, AST.isTypeDeclaration).find(declaration =>
          declaration.name === child.root
        )
        if (target && !this.allowsDeclaration(target, seen)) {
          return false
        }
      }
      for (const reference of AST.streamReferences(child)) {
        const target = 'ref' in reference.reference ? reference.reference.ref : undefined
        if (target && !this.allowsDeclaration(target, seen)) {
          return false
        }
      }
    }
    return true
  }
}

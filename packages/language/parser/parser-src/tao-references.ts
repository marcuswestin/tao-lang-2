import { Langium } from './langium-exports'
import type { PackageResolver } from './package-resolver'
import * as AST from './parserASTExport'

/**
 * TaoReferences extends Langium's DefaultReferences to resolve Tao design declarations and
 * style bundle/token references, supporting Go-to-Definition and Find-References for styles.
 */
export class TaoReferences extends Langium.DefaultReferences {
  constructor(
    services: Langium.LangiumCoreServices,
    private readonly packages: PackageResolver,
  ) {
    super(services)
  }

  override findDeclarations(sourceCstNode: Langium.CstNode): Langium.AstNode[] {
    const shade = designShadeFromCstNode(sourceCstNode)
    if (shade) {
      return [shade]
    }
    const parameter = colorClauseParameterFromCstNode(sourceCstNode)
    if (parameter) {
      return [parameter]
    }
    const defaultDeclarations = super.findDeclarations(sourceCstNode)
    if (defaultDeclarations.length > 0) {
      return defaultDeclarations
    }
    return this.findDesignDeclarations(sourceCstNode)
  }

  override findReferences(
    targetNode: Langium.AstNode,
    options: Langium.FindReferencesOptions,
  ): Langium.Stream<Langium.ReferenceDescription> {
    const defaultRefs = super.findReferences(targetNode, options)
    const name = designMemberName(targetNode)
    if (!name) {
      return defaultRefs
    }
    const designRefs = this.findDesignMemberReferences(targetNode, name, options)
    return defaultRefs.concat(designRefs)
  }

  private findDesignDeclarations(sourceCstNode: Langium.CstNode): Langium.AstNode[] {
    const word = layoutWordFromCstNode(sourceCstNode)
    const path = designValuePathFromCstNode(sourceCstNode)
    if (!word && !path) {
      return []
    }

    const candidateNames = collectLookupNames(word, path, sourceCstNode)
    if (candidateNames.length === 0) {
      return []
    }

    const root = AST.findRoot(sourceCstNode.astNode)
    if (!AST.isTaoFile(root)) {
      return []
    }

    const enclosingDesign = findEnclosingDesign(sourceCstNode.astNode)

    // The tiers follow what the source can actually reach, narrowest first: the design being authored,
    // the design this file's app mounts, designs declared here, folder siblings, imports, and finally
    // the design some app in the workspace mounts -- which is the selection DesignValidator resolves
    // against. There is deliberately no "any design that happens to spell it this way" tier: a member
    // private to an unrelated design is not this word's declaration however alike the two names read.
    const tiers: AST.DesignDeclaration[][] = [
      enclosingDesign ? [enclosingDesign] : [],
      findFileAppDesigns(root, this.documents),
      root.statements.filter(AST.isDesignDeclaration),
      findFolderDesigns(root, this.documents),
      findImportedDesigns(root, this.documents, this.packages),
      findWorkspaceAppDesigns(this.documents),
    ]

    const seenDesigns = new Set<AST.DesignDeclaration>()

    for (const tier of tiers) {
      const reachable = tier.filter(design => !seenDesigns.has(design))
      reachable.forEach(design => seenDesigns.add(design))
      // Candidate names are ordered most specific first, and the first one that resolves wins the
      // tier: `palette.60` names the shade, not the entry it hangs off and the entry's own uses.
      for (const name of candidateNames) {
        const matches: Langium.AstNode[] = []
        for (const design of reachable) {
          const member = findDesignMember(design, name)
          if (member && !matches.includes(member)) {
            matches.push(member)
          }
        }
        if (matches.length > 0) {
          return matches
        }
      }
    }

    return []
  }

  private findDesignMemberReferences(
    targetNode: Langium.AstNode,
    name: string,
    options: Langium.FindReferencesOptions,
  ): Langium.ReferenceDescription[] {
    const targetDoc = AST.getDocument(targetNode)
    const targetPath = this.nodeLocator.getAstNodePath(targetNode)
    const refs: Langium.ReferenceDescription[] = []

    const docs = options.documentUri
      ? [this.documents.getDocument(options.documentUri)].filter(
        (doc): doc is Langium.LangiumDocument => doc !== undefined,
      )
      : Array.from(this.documents.all)

    for (const doc of docs) {
      const file = doc.parseResult.value
      if (!AST.isTaoFile(file)) {
        continue
      }
      for (const node of AST.streamAllContents(file)) {
        if (!AST.isLayoutWord(node) && !AST.isDesignValuePath(node) && !AST.isMemberAccessExpression(node)) {
          continue
        }
        const cstNode = node.$cstNode
        const segment = AST.isMemberAccessExpression(node)
          ? designShadeReferenceSegment(node, targetNode)
          : designReferenceSegment(node, name)
        if (cstNode === undefined || segment === undefined) {
          continue
        }
        // Spelling only narrows the candidates. Whether this word is a reference to *this* member is
        // settled by resolving it the way go-to-definition does and comparing the declaration itself:
        // two designs may each declare a private `header`, and one is not a reference to the other.
        if (
          AST.isMemberAccessExpression(node)
            ? designShadeFromCstNode(segment) !== targetNode
            : !this.findDesignDeclarationsForNames(cstNode, [name]).includes(targetNode)
        ) {
          continue
        }
        refs.push({
          local: doc.uri.toString() === targetDoc.uri.toString(),
          segment: {
            end: segment.end,
            length: segment.length,
            offset: segment.offset,
            range: segment.range,
          },
          sourcePath: this.nodeLocator.getAstNodePath(node),
          sourceUri: doc.uri,
          targetPath,
          targetUri: targetDoc.uri,
        })
      }
    }

    return refs
  }

  private findDesignDeclarationsForNames(
    sourceCstNode: Langium.CstNode,
    candidateNames: readonly string[],
  ): Langium.AstNode[] {
    const word = layoutWordFromCstNode(sourceCstNode)
    const path = designValuePathFromCstNode(sourceCstNode)
    if (!word && !path) {
      return []
    }
    const root = AST.findRoot(sourceCstNode.astNode)
    if (!AST.isTaoFile(root)) {
      return []
    }
    const enclosingDesign = findEnclosingDesign(sourceCstNode.astNode)
    const tiers: AST.DesignDeclaration[][] = [
      enclosingDesign ? [enclosingDesign] : [],
      findFileAppDesigns(root, this.documents),
      root.statements.filter(AST.isDesignDeclaration),
      findFolderDesigns(root, this.documents),
      findImportedDesigns(root, this.documents, this.packages),
      findWorkspaceAppDesigns(this.documents),
    ]
    const seenDesigns = new Set<AST.DesignDeclaration>()
    for (const tier of tiers) {
      const reachable = tier.filter(design => !seenDesigns.has(design))
      reachable.forEach(design => seenDesigns.add(design))
      for (const name of candidateNames) {
        const matches = reachable.flatMap(design => {
          const member = findDesignMember(design, name)
          return member ? [member] : []
        })
        if (matches.length > 0) {
          return [...new Set(matches)]
        }
      }
    }
    return []
  }
}

/** layoutWordFullName returns the hyphenated-and-dotted full name of a LayoutWord. */
function layoutWordFullName(word: AST.LayoutWord): string {
  const head = [word.value, ...word.suffixes].join('-')
  return word.pathSegments.length > 0 ? `${head}.${word.pathSegments.join('.')}` : head
}

/** findDesignMember searches all member kinds of a design declaration for a matching name. */
function findDesignMember(
  design: AST.DesignDeclaration,
  name: string,
): AST.Node | undefined {
  for (const member of design.block.members) {
    if (AST.isDesignBundle(member) || AST.isDesignToken(member)) {
      if (member.name === name) {
        return member
      }
    } else if (AST.isDesignColorsBlock(member)) {
      for (const entry of member.entries) {
        if (entry.name === name) {
          return entry
        }
        for (const family of entry.family?.members ?? []) {
          if (`${entry.name}.${family.name}` === name) {
            return family
          }
        }
      }
    } else if (AST.isDesignSizesBlock(member)) {
      for (const entry of member.entries) {
        if (entry.name === name) {
          return entry
        }
      }
    } else if (AST.isDesignTextBlock(member)) {
      for (const entry of member.entries) {
        if (entry.name === name) {
          return entry
        }
      }
    } else if (AST.isDesignScreensBlock(member)) {
      for (const entry of member.entries) {
        if (entry.name === name) {
          return entry
        }
      }
    } else if (AST.isDesignStylesBlock(member)) {
      for (const entry of member.entries) {
        if (entry.name === name) {
          return entry
        }
      }
    }
  }
  return undefined
}

function layoutWordFromCstNode(cstNode: Langium.CstNode): AST.LayoutWord | undefined {
  let current: Langium.AstNode | undefined = cstNode.astNode
  while (current) {
    if (AST.isLayoutWord(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

function designValuePathFromCstNode(cstNode: Langium.CstNode): AST.DesignValuePath | undefined {
  let current: Langium.AstNode | undefined = cstNode.astNode
  while (current) {
    if (AST.isDesignValuePath(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

/** A shade on a color argument is a numeric AST property, not a Langium cross-reference. */
function designShadeFromCstNode(cstNode: Langium.CstNode): AST.DesignColorFamilyMember | undefined {
  let current: Langium.AstNode | undefined = cstNode.astNode
  while (current && !AST.isMemberAccessExpression(current)) {
    current = current.$container
  }
  if (!AST.isMemberAccessExpression(current) || current.shade === undefined) {
    return undefined
  }
  const segment = Langium.GrammarUtils.findNodeForProperty(current.$cstNode, 'shade')
  if (!segment || !containsCstNode(segment, cstNode)) {
    return undefined
  }
  const color = current.target.ref
  return AST.isDesignColorEntry(color) ? AST.designColorShade(color, current.shade) : undefined
}

/** A capitalized color clause word reads a parameter of its owning view. */
function colorClauseParameterFromCstNode(cstNode: Langium.CstNode): AST.ParameterDeclaration | undefined {
  const word = layoutWordFromCstNode(cstNode)
  let current: Langium.AstNode | undefined = word?.$container
  while (current && !AST.isLayoutEntry(current)) {
    current = current.$container
  }
  const entry = current
  if (
    !word || !AST.isLayoutEntry(entry) || entry.terms.length !== 1 || entry.terms[0] !== word
    || !AST.isLayoutWord(entry.head) || !['background', 'ink', 'border', 'bg', 'fg'].includes(entry.head.value)
    || !/^[A-Z]/.test(word.value)
  ) {
    return undefined
  }
  const view = AST.findOwningView(word)
  return view && AST.parametersOf(view).find(parameter =>
    parameter.inlineType?.name === word.value
    && AST.isPrimitiveTypeReference(parameter.inlineType?.type)
    && parameter.inlineType.type.primitive === 'color'
  )
}

function collectLookupNames(
  word: AST.LayoutWord | undefined,
  path: AST.DesignValuePath | undefined,
  sourceCstNode: Langium.CstNode,
): string[] {
  if (word) {
    const full = layoutWordFullName(word)
    const cstNode = word.$cstNode
    const head = Langium.GrammarUtils.findNodeForProperty(cstNode, 'value')
    if (head && containsCstNode(head, sourceCstNode)) {
      return [word.value]
    }
    const pathSegments = Langium.GrammarUtils.findNodesForProperty(cstNode, 'pathSegments')
    const pathIndex = pathSegments.findIndex(segment => containsCstNode(segment, sourceCstNode))
    if (pathIndex >= 0) {
      return [[[word.value, ...word.suffixes].join('-'), ...word.pathSegments.slice(0, pathIndex + 1)].join('.')]
    }
    return full === word.value ? [full] : [full, word.value]
  }
  if (path) {
    const full = [path.head, ...path.segments].join('.')
    const cstNode = path.$cstNode
    const head = Langium.GrammarUtils.findNodeForProperty(cstNode, 'head')
    if (head && containsCstNode(head, sourceCstNode)) {
      return [path.head]
    }
    const segments = Langium.GrammarUtils.findNodesForProperty(cstNode, 'segments')
    const segmentIndex = segments.findIndex(segment => containsCstNode(segment, sourceCstNode))
    if (segmentIndex >= 0) {
      return [[path.head, ...path.segments.slice(0, segmentIndex + 1)].join('.')]
    }
    return full === path.head ? [full] : [full, path.head]
  }
  return sourceCstNode.text ? [sourceCstNode.text] : []
}

function designReferenceSegment(
  node: AST.LayoutWord | AST.DesignValuePath,
  targetName: string,
): Langium.CstNode | undefined {
  const cstNode = node.$cstNode
  if (!cstNode) {
    return undefined
  }
  const fullName = AST.isLayoutWord(node)
    ? layoutWordFullName(node)
    : [node.head, ...node.segments].join('.')
  const head = AST.isLayoutWord(node) ? node.value : node.head
  if (fullName === targetName) {
    const property = AST.isLayoutWord(node) ? 'pathSegments' : 'segments'
    const segments = AST.isLayoutWord(node) ? node.pathSegments : node.segments
    if (segments.length > 0) {
      return Langium.GrammarUtils.findNodeForProperty(cstNode, property, segments.length - 1)
    }
    return cstNode
  }
  if (head === targetName) {
    return Langium.GrammarUtils.findNodeForProperty(cstNode, AST.isLayoutWord(node) ? 'value' : 'head')
  }
  return undefined
}

function designShadeReferenceSegment(
  node: AST.MemberAccessExpression,
  target: Langium.AstNode,
): Langium.CstNode | undefined {
  const color = node.target.ref
  return AST.isDesignColorFamilyMember(target) && AST.isDesignColorEntry(color)
      && node.shade !== undefined && AST.designColorShade(color, node.shade) === target
    ? Langium.GrammarUtils.findNodeForProperty(node.$cstNode, 'shade')
    : undefined
}

function containsCstNode(container: Langium.CstNode, candidate: Langium.CstNode): boolean {
  return candidate.offset >= container.offset && candidate.end <= container.end
}

function findEnclosingDesign(node: Langium.AstNode): AST.DesignDeclaration | undefined {
  let current: Langium.AstNode | undefined = node
  while (current) {
    if (AST.isDesignDeclaration(current)) {
      return current
    }
    current = current.$container
  }
  return undefined
}

function findFileAppDesigns(
  file: AST.TaoFile,
  documents: Langium.LangiumDocuments,
): AST.DesignDeclaration[] {
  const designs: AST.DesignDeclaration[] = []
  for (const app of file.statements.filter(AST.isAppDeclaration)) {
    const design = appSelectedDesign(app, file, documents)
    if (design && !designs.includes(design)) {
      designs.push(design)
    }
  }
  return designs
}

function findWorkspaceAppDesigns(documents: Langium.LangiumDocuments): AST.DesignDeclaration[] {
  const designs: AST.DesignDeclaration[] = []
  for (const doc of documents.all) {
    const file = doc.parseResult.value
    if (!AST.isTaoFile(file)) {
      continue
    }
    for (const app of file.statements.filter(AST.isAppDeclaration)) {
      const design = appSelectedDesign(app, file, documents)
      if (design && !designs.includes(design)) {
        designs.push(design)
      }
    }
  }
  return designs
}

function findFolderDesigns(
  file: AST.TaoFile,
  documents: Langium.LangiumDocuments,
): AST.DesignDeclaration[] {
  const doc = AST.getDocument(file)
  const currentPath = doc.uri.path
  const currentDir = currentPath.slice(0, currentPath.lastIndexOf('/'))
  const designs: AST.DesignDeclaration[] = []

  for (const otherDoc of documents.all) {
    const otherPath = otherDoc.uri.path
    if (otherPath === currentPath || otherPath.slice(0, otherPath.lastIndexOf('/')) !== currentDir) {
      continue
    }
    const otherFile = otherDoc.parseResult.value
    if (!AST.isTaoFile(otherFile)) {
      continue
    }
    for (const statement of otherFile.statements) {
      if (
        AST.isDesignDeclaration(statement)
        && statement.visibility === 'folder'
        && !designs.includes(statement)
      ) {
        designs.push(statement)
      }
    }
  }
  return designs
}

function findImportedDesigns(
  file: AST.TaoFile,
  documents: Langium.LangiumDocuments,
  packages: PackageResolver,
): AST.DesignDeclaration[] {
  const designs: AST.DesignDeclaration[] = []
  const currentDoc = AST.getDocument(file)
  const allFiles = Array.from(documents.all)
    .map(doc => doc.parseResult.value)
    .filter(AST.isTaoFile)

  for (const useStatement of file.statements.filter(AST.isUseStatement)) {
    for (const decl of AST.resolvedImportedDeclarations(useStatement)) {
      if (AST.isDesignDeclaration(decl) && !designs.includes(decl)) {
        designs.push(decl)
      }
    }
    const targets = packages.collectTargetDeclarations(useStatement, {
      fromFilePath: currentDoc.uri.path,
      workspaceFiles: allFiles,
    })
    for (const target of targets) {
      if (AST.isDesignDeclaration(target) && !designs.includes(target)) {
        designs.push(target)
      }
    }
  }
  return designs
}

function appSelectedDesign(
  app: AST.AppDeclaration,
  file: AST.TaoFile,
  documents: Langium.LangiumDocuments,
): AST.DesignDeclaration | undefined {
  if (app.block) {
    for (const stmt of app.block.statements) {
      if (AST.isAppProperty(stmt) && stmt.name === 'Design') {
        const design = resolveDesignFromValue(stmt.value, file)
        if (design) {
          return design
        }
      }
    }
  }
  if (app.value) {
    if (AST.isRefinementExpression(app.value)) {
      const patched = app.value.patchBlock.entries.findLast(entry =>
        entry.name === 'Design' && entry.value !== undefined
      )
      if (patched) {
        return resolveDesignFromValue(patched.value, file)
      }
    }
    const baseApp = resolveBaseApp(app.value, file)
    if (baseApp) {
      return appSelectedDesign(baseApp, file, documents)
    }
  }
  return undefined
}

function resolveDesignFromValue(
  expression: AST.Expression | AST.ConfigurationValue | undefined,
  file: AST.TaoFile,
): AST.DesignDeclaration | undefined {
  if (!expression) {
    return undefined
  }
  if (AST.isValueReference(expression) || AST.isConfigurationReference(expression)) {
    const target = expression.target?.ref
    if (AST.isDesignDeclaration(target)) {
      return target
    }
    const targetName = expression.target?.$refText
    if (targetName) {
      const local = file.statements.find(s => AST.isDesignDeclaration(s) && s.name === targetName)
      if (local && AST.isDesignDeclaration(local)) {
        return local
      }
    }
  }
  return undefined
}

function resolveBaseApp(
  expression: AST.Expression,
  file: AST.TaoFile,
): AST.AppDeclaration | undefined {
  if (AST.isRefinementExpression(expression)) {
    const ref = expression.target?.ref
    if (AST.isAppDeclaration(ref)) {
      return ref
    }
    const name = expression.target?.$refText
    if (name) {
      const local = file.statements.find(s => AST.isAppDeclaration(s) && s.name === name)
      if (local && AST.isAppDeclaration(local)) {
        return local
      }
    }
  }
  if (AST.isValueReference(expression)) {
    const ref = expression.target?.ref
    if (AST.isAppDeclaration(ref)) {
      return ref
    }
    const name = expression.target?.$refText
    if (name) {
      const local = file.statements.find(s => AST.isAppDeclaration(s) && s.name === name)
      if (local && AST.isAppDeclaration(local)) {
        return local
      }
    }
  }
  return undefined
}

function designMemberName(node: Langium.AstNode): string | undefined {
  if (
    AST.isDesignBundle(node)
    || AST.isDesignToken(node)
    || AST.isDesignColorEntry(node)
    || AST.isDesignSizeEntry(node)
    || AST.isDesignTextEntry(node)
    || AST.isDesignScreenEntry(node)
    || AST.isDesignStyleEntry(node)
  ) {
    return node.name
  }
  if (AST.isDesignColorFamilyMember(node)) {
    const entry = node.$container?.$container
    if (AST.isDesignColorEntry(entry)) {
      return `${entry.name}.${node.name}`
    }
    return String(node.name)
  }
  return undefined
}

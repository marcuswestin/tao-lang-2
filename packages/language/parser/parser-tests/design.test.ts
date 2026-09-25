import { ASTUtils } from '@ast-utils'
import { AST, Langium, Parser, URI } from '@parser'
import { FS } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { testParseCode } from './test-parse'

Describe('parser: minimal design declarations', () => {
  Test('parses flat colors, named combined bundles, app selection, and render use', async () => {
    const parsed = await testParseCode(`
      workspace design WordFlowerDesign {
        short #abc
        alpha #abcd
        ink #121826
        overlayColor #121826cc
        screen [fill, content top stretch, pad 16, bg ink]
        constrained [screen, claim 2, width max 720, centered]
      }

      app Demo {
        view Main
        Design WordFlowerDesign
      }

      view Main() {
        render Col() [constrained]
      }
      view Col() { }
    `)

    const design = parsed.entry.ast.statements.find(AST.isDesignDeclaration)
    Expect(design?.visibility).toBe('workspace')
    Expect(design?.block.members.filter(AST.isDesignToken).map(token => token.value)).toEqual([
      '#abc',
      '#abcd',
      '#121826',
      '#121826cc',
    ])
    Expect(design?.block.members.filter(AST.isDesignBundle).map(bundle => bundle.name)).toEqual([
      'screen',
      'constrained',
    ])
    const app = parsed.entry.ast.statements.find(AST.isAppDeclaration)
    const selected = app?.block?.statements.find(AST.isAppProperty)
    Expect(selected?.value && AST.isValueReference(selected.value) ? selected.value.target.ref : undefined).toBe(design)
  })

  Test('keeps digit-leading contextual tokens parseable in tag syntax for semantic validation', async () => {
    const parsed = await testParseCode(`
      test "tag shape" {
        test "digit tag" {
          press #123abc
        }
      }
    `)

    const tagPress = AST.streamAllContents(parsed.entry.ast).find(AST.isTagPressStep)
    Expect(tagPress?.tag).toBe('#123abc')
  })

  Test('preserves repeated combined clauses in authored left-to-right order', async () => {
    const parsed = await testParseCode(`
      design Theme {
        compact [gap 8, gap 12, width 960, width max 720]
      }
    `)

    const bundle = AST.streamAllContents(parsed.entry.ast).find(AST.isDesignBundle)
    Expect(bundle?.spec.entries.map(ASTUtils.layoutEntryValues)).toEqual([
      ['gap', 8],
      ['gap', 12],
      ['width', 960],
      ['width', 'max', 720],
    ])
  })

  Test('parses raw color explorations in render and bundle clauses', async () => {
    const parsed = await testParseCode(`
      design Theme { alert [fg #c00] }
      view Main() { render Surface() [bg #fff, alert] }
      view Surface() { }
    `)

    const entries = [...AST.streamAllContents(parsed.entry.ast).filter(AST.isLayoutEntry)]
      .map(ASTUtils.layoutEntryValues)
    Expect(entries).toContainEqual(['fg', '#c00'])
    Expect(entries).toContainEqual(['bg', '#fff'])
  })

  Test('parses a declaration header clause and `none` as a clearing term', async () => {
    const parsed = await testParseCode(`
      design Theme { paper #fff }
      type Answer is one of Yes
      view Card() [pad 12, bg paper] { render Surface() [bg none, pad left none] }
      scene Page() responds Answer [gap 8] { render Surface() }
      view Surface() { }
    `)

    const views = [...AST.streamAllContents(parsed.entry.ast).filter(AST.isViewDeclaration)]
    const clauses = views.map(view => [view.name, view.layoutClause?.entries.map(ASTUtils.layoutEntryValues)])
    Expect(clauses).toEqual([
      ['Card', [['pad', 12], ['bg', 'paper']]],
      ['Page', [['gap', 8]]],
      ['Surface', undefined],
    ])
    const entries = [...AST.streamAllContents(parsed.entry.ast).filter(AST.isLayoutEntry)]
      .map(ASTUtils.layoutEntryValues)
    Expect(entries).toContainEqual(['bg', 'none'])
    Expect(entries).toContainEqual(['pad', 'left', 'none'])
  })

  Test('preserves representable decided visual and spacing terms as typed layout AST values', async () => {
    const parsed = await testParseCode(`
      design Theme {
        canvas #fff
        ink #111
        lineColor #ddd
        card [background canvas, ink ink, border lineColor, radius 12, pad 16, gap 8]
        body [size 16, weight 600, line 22]
      }
    `)

    const bundles = [...AST.streamAllContents(parsed.entry.ast).filter(AST.isDesignBundle)]
    Expect(bundles.map(bundle => [bundle.name, bundle.spec.entries.map(ASTUtils.layoutEntryValues)])).toEqual([
      ['card', [
        ['background', 'canvas'],
        ['ink', 'ink'],
        ['border', 'lineColor'],
        ['radius', 12],
        ['pad', 16],
        ['gap', 8],
      ]],
      ['body', [['size', 16], ['weight', 600], ['line', 22]]],
    ])
  })

  Test('resolves design bundle and token declarations for layout words through References', async () => {
    const { services } = Parser.createContext()
    const source = `
      design HNDesign {
        accent #ff6600
        header [pad 14, bg accent]
        headerTitle [size 19]
      }
      app HNReader {
        Design HNDesign
        view Main
      }
      view Main() {
        render Col() [header] {
          Text("Title") [headerTitle]
        }
      }
      view Col() { }
      view Text(Text text) { }
    `
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.file('/test.tao'))
    services.shared.workspace.LangiumDocuments.addDocument(doc)
    await services.shared.workspace.DocumentBuilder.build([doc], { eagerLinking: true })

    const file = doc.parseResult.value
    Expect(AST.isTaoFile(file)).toBe(true)
    if (!AST.isTaoFile(file)) {
      return
    }
    const design = file.statements.find(AST.isDesignDeclaration)
    const headerMember = design?.block.members.find(
      (member): member is AST.DesignBundle => AST.isDesignBundle(member) && member.name === 'header',
    )
    const titleMember = design?.block.members.find(
      (member): member is AST.DesignBundle => AST.isDesignBundle(member) && member.name === 'headerTitle',
    )
    const accentToken = design?.block.members.find(
      (member): member is AST.DesignToken => AST.isDesignToken(member) && member.name === 'accent',
    )

    // [header] at render site resolves to 'header' bundle in HNDesign
    const headerWord = AST.streamAllContents(file).find(
      node =>
        AST.isLayoutWord(node) && node.value === 'header'
        && !AST.isDesignBundle(node.$container?.$container?.$container),
    )
    Expect(headerWord?.$cstNode).toBeDefined()
    const headerDecls = services.language.references.References.findDeclarations(headerWord!.$cstNode!)
    Expect(headerDecls).toHaveLength(1)
    Expect(headerDecls[0]).toBe(headerMember)

    // [headerTitle] at render site resolves to 'headerTitle' bundle in HNDesign
    const titleWord = AST.streamAllContents(file).find(
      node => AST.isLayoutWord(node) && node.value === 'headerTitle',
    )
    Expect(titleWord?.$cstNode).toBeDefined()
    const titleDecls = services.language.references.References.findDeclarations(titleWord!.$cstNode!)
    Expect(titleDecls).toHaveLength(1)
    Expect(titleDecls[0]).toBe(titleMember)

    // 'accent' in [pad 14, bg accent] inside the design bundle resolves to 'accent' token in HNDesign
    const accentWord = AST.streamAllContents(file).find(
      node => AST.isLayoutWord(node) && node.value === 'accent',
    )
    Expect(accentWord?.$cstNode).toBeDefined()
    const accentDecls = services.language.references.References.findDeclarations(accentWord!.$cstNode!)
    Expect(accentDecls).toHaveLength(1)
    Expect(accentDecls[0]).toBe(accentToken)

    // References to 'header' bundle includes declaration and render site
    const headerRefs = services.language.references.References.findReferences(headerMember!, {
      includeDeclaration: true,
    }).toArray()
    Expect(headerRefs).toHaveLength(2)
  })

  Test('keeps same-named members of two private designs apart in definitions and references', async () => {
    const { services } = Parser.createContext()
    // Two projects, each with its own file-private design that spells two members the same way.
    const shipped = `
      design Shipped {
        colors { palette #112233 { 60 #001122 } }
        header [pad 14, bg palette.60]
      }
      app Reader {
        Design Shipped
        view Main
      }
      view Main() { render Col() [header] }
      view Col() { }
    `
    const draft = `
      design Draft {
        colors { palette #445566 { 60 #334455 } }
        header [pad 20, bg palette.60]
      }
    `
    const shippedDoc = services.shared.workspace.LangiumDocumentFactory.fromString(
      shipped,
      URI.file('/shipped/Main.tao'),
    )
    const draftDoc = services.shared.workspace.LangiumDocumentFactory.fromString(
      draft,
      URI.file('/draft/Draft.tao'),
    )
    services.shared.workspace.LangiumDocuments.addDocument(shippedDoc)
    services.shared.workspace.LangiumDocuments.addDocument(draftDoc)
    await services.shared.workspace.DocumentBuilder.build([shippedDoc, draftDoc], { eagerLinking: true })

    const shippedFile = shippedDoc.parseResult.value
    const draftFile = draftDoc.parseResult.value
    Expect(AST.isTaoFile(shippedFile) && AST.isTaoFile(draftFile)).toBe(true)
    if (!AST.isTaoFile(shippedFile) || !AST.isTaoFile(draftFile)) {
      return
    }
    const shippedDesign = shippedFile.statements.filter(AST.isDesignDeclaration)[0]!
    const draftDesign = draftFile.statements.filter(AST.isDesignDeclaration)[0]!
    const bundle = (design: AST.DesignDeclaration, name: string): AST.DesignBundle =>
      design.block.members.find(
        (member): member is AST.DesignBundle => AST.isDesignBundle(member) && member.name === name,
      )!
    const familyMember = (design: AST.DesignDeclaration, entry: string, shade: string): AST.Node =>
      design.block.members.find(AST.isDesignColorsBlock)!
        .entries.find(candidate => candidate.name === entry)!
        .family!.members.find(candidate => String(candidate.name) === shade)!
    const words = (file: AST.TaoFile, value: string): AST.LayoutWord[] => {
      const found: AST.LayoutWord[] = []
      for (const node of AST.streamAllContents(file)) {
        if (AST.isLayoutWord(node) && node.value === value) {
          found.push(node)
        }
      }
      return found
    }

    const references = services.language.references.References

    // The render site resolves to the design its own app mounts, never to the other project's `header`.
    const shippedHeaderDecls = references.findDeclarations(words(shippedFile, 'header')[0]!.$cstNode!)
    Expect(shippedHeaderDecls).toHaveLength(1)
    Expect(shippedHeaderDecls[0]).toBe(bundle(shippedDesign, 'header'))

    // `palette.60` inside each design names that design's own shade -- the most specific name that
    // resolves, not the `palette` entry it hangs off, and not the other project's shade of the same
    // name. Identity is asserted directly, never structurally: `@shared/test` refuses a deep-equality
    // matcher on a Langium node because bun's formatter expands one exponentially through its
    // `$container` links, which has taken a 128 GB machine out of application memory.
    const shippedShadeDecls = references.findDeclarations(words(shippedFile, 'palette')[0]!.$cstNode!)
    Expect(shippedShadeDecls).toHaveLength(1)
    Expect(shippedShadeDecls[0]).toBe(familyMember(shippedDesign, 'palette', '60'))
    const draftShadeDecls = references.findDeclarations(words(draftFile, 'palette')[0]!.$cstNode!)
    Expect(draftShadeDecls).toHaveLength(1)
    Expect(draftShadeDecls[0]).toBe(familyMember(draftDesign, 'palette', '60'))

    // Find-references is identity-based. The shipped `header` is used once, at its render site; the
    // draft's is declared and never used. Matching on spelling alone gave each the other's uses too.
    Expect(
      references.findReferences(bundle(shippedDesign, 'header'), { includeDeclaration: false })
        .toArray().map(reference => reference.sourceUri.path),
    ).toEqual(['/shipped/Main.tao'])
    Expect(
      references.findReferences(bundle(draftDesign, 'header'), { includeDeclaration: false }).toArray(),
    ).toEqual([])
  })

  Test('keeps file-private sibling designs out of definition lookup', async () => {
    const { services } = Parser.createContext()
    const source = `view Main() { render Col() [privateCard] }\nview Col() { }`
    const privateDesign = `design PrivateTheme { privateCard [pad 8] }`
    const sourceDoc = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.file('/app/Main.tao'))
    const designDoc = services.shared.workspace.LangiumDocumentFactory.fromString(
      privateDesign,
      URI.file('/app/PrivateTheme.tao'),
    )
    services.shared.workspace.LangiumDocuments.addDocument(sourceDoc)
    services.shared.workspace.LangiumDocuments.addDocument(designDoc)
    await services.shared.workspace.DocumentBuilder.build([sourceDoc, designDoc], { eagerLinking: true })

    const file = sourceDoc.parseResult.value
    Expect(AST.isTaoFile(file)).toBe(true)
    if (!AST.isTaoFile(file)) {
      return
    }
    const word = AST.streamAllContents(file).find(
      node => AST.isLayoutWord(node) && node.value === 'privateCard',
    )
    Expect(word?.$cstNode).toBeDefined()
    Expect(services.language.references.References.findDeclarations(word!.$cstNode!)).toHaveLength(0)
  })

  Test('finds design references inside structured blocks without replacing dotted suffixes', async () => {
    const { services } = Parser.createContext()
    const source = `
      design Theme {
        colors {
          palette #112233 { 60 #001122 }
          accent palette.60
        }
      }
    `
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      source,
      URI.file('/Theme.tao'),
    )
    services.shared.workspace.LangiumDocuments.addDocument(doc)
    await services.shared.workspace.DocumentBuilder.build([doc], { eagerLinking: true })

    const file = doc.parseResult.value
    Expect(AST.isTaoFile(file)).toBe(true)
    if (!AST.isTaoFile(file)) {
      return
    }
    const design = file.statements.find(AST.isDesignDeclaration)!
    const palette = design.block.members.find(AST.isDesignColorsBlock)!.entries[0]!
    const shade = palette.family!.members[0]!
    const references = services.language.references.References

    const paletteRefs = references.findReferences(palette, { includeDeclaration: false }).toArray()
    Expect(paletteRefs).toHaveLength(1)
    Expect(doc.textDocument.getText(paletteRefs[0]!.segment.range)).toBe('palette')

    const shadeRefs = references.findReferences(shade, { includeDeclaration: false }).toArray()
    Expect(shadeRefs).toHaveLength(1)
    Expect(doc.textDocument.getText(shadeRefs[0]!.segment.range)).toBe('60')
  })

  Test('resolves and renames each dotted design path token by declaration identity', async () => {
    const { services } = Parser.createLspContext()
    const source = `design Theme { colors { palette #112233 { 60 #001122 } accent palette.60 } }`
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      source,
      URI.file('/Theme.tao'),
    )
    services.shared.workspace.LangiumDocuments.addDocument(doc)
    await services.shared.workspace.DocumentBuilder.build([doc], { eagerLinking: true })

    const file = doc.parseResult.value
    Expect(AST.isTaoFile(file)).toBe(true)
    if (!AST.isTaoFile(file)) {
      return
    }
    const design = file.statements.find(AST.isDesignDeclaration)!
    const palette = design.block.members.find(AST.isDesignColorsBlock)!.entries[0]!
    const shade = palette.family!.members[0]!
    const pathOffset = source.lastIndexOf('palette.60')
    const root = file.$cstNode!
    const head = Langium.CstUtils.findLeafNodeAtOffset(root, pathOffset + 2)!
    const suffix = Langium.CstUtils.findLeafNodeAtOffset(root, pathOffset + 'palette.'.length)!
    const references = services.language.references.References

    const headDeclarations = references.findDeclarations(head)
    const suffixDeclarations = references.findDeclarations(suffix)
    Expect(headDeclarations).toHaveLength(1)
    Expect(headDeclarations[0] === palette).toBe(true)
    Expect(suffixDeclarations).toHaveLength(1)
    Expect(suffixDeclarations[0] === shade).toBe(true)

    const rename = services.language.lsp.RenameProvider
    Expect(rename).toBeDefined()
    if (!rename) {
      return
    }
    const headEdit = await rename.rename(doc, {
      newName: 'swatch',
      position: doc.textDocument.positionAt(pathOffset + 2),
      textDocument: { uri: doc.uri.toString() },
    })
    Expect(renameSegments(doc, headEdit)).toEqual(['palette', 'palette'])
    Expect(applyRename(doc, headEdit)).toBe(
      `design Theme { colors { swatch #112233 { 60 #001122 } accent swatch.60 } }`,
    )

    const shadeEdit = await rename.rename(doc, {
      newName: '70',
      position: doc.textDocument.positionAt(pathOffset + 'palette.'.length),
      textDocument: { uri: doc.uri.toString() },
    })
    Expect(renameSegments(doc, shadeEdit)).toEqual(['60', '60'])
    Expect(applyRename(doc, shadeEdit)).toBe(
      `design Theme { colors { palette #112233 { 70 #001122 } accent palette.70 } }`,
    )
  })
})

Describe('parser: color values', () => {
  const colorSource = `
    workspace design Theme {
      colors {
        accent #2f6b4f { 20 #cfe3d8 }
        inkMuted #6b7280
      }
      styles { dot [width 8] }
    }
    app Demo { view Main Design Theme }
    view Main() { render Badge(Tint: accent.20) }
    view Badge(Tint color default inkMuted) { render Surface() [dot, background Tint] }
    view Surface() { }
  `

  Test('parses a color parameter whose default and argument link to the mounted design colors', async () => {
    const parsed = await testParseCode(colorSource)

    const badge = parsed.entry.ast.statements.filter(AST.isViewDeclaration).find(view => view.name === 'Badge')
    const parameter = badge === undefined ? undefined : AST.parametersOf(badge)[0]
    const type = parameter?.inlineType?.type
    Expect.Is(type, AST.isPrimitiveTypeReference)
    Expect(type.primitive).toBe('color')
    const fallback = parameter?.defaultValue
    Expect.Is(fallback, AST.isValueReference)
    Expect.Is(fallback.target.ref, AST.isDesignColorEntry)
    Expect(fallback.target.ref.name).toBe('inkMuted')

    const argument = AST.streamAllContents(parsed.entry.ast).find(AST.isArgument)?.value
    Expect.Is(argument, AST.isMemberAccessExpression)
    Expect(argument.shade).toBe(20)
    Expect(argument.members).toEqual([])
    Expect.Is(argument.target.ref, AST.isDesignColorEntry)
    Expect(argument.target.ref.name).toBe('accent')
  })

  Test('reads a Capitalized word after a color head as the value in scope', async () => {
    const parsed = await testParseCode(colorSource)

    const entry = AST.streamAllContents(parsed.entry.ast).filter(AST.isLayoutEntry)
      .find(candidate => ASTUtils.layoutEntryValues(candidate)[0] === 'background')
    Expect.Is(entry, AST.isLayoutEntry)
    const word = ASTUtils.colorValues.clauseValueRead(entry)
    Expect(word?.value).toBe('Tint')
    const value = ASTUtils.colorValues.clauseValueNamed(entry, 'Tint')
    Expect.Is(value, AST.isParameterDeclaration)
    Expect(ASTUtils.colorValues.isColorValue(value)).toBe(true)
  })

  Test('goes from a color clause value to its view parameter', async () => {
    const { services } = Parser.createContext()
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(colorSource, URI.file('/colors/Main.tao'))
    services.shared.workspace.LangiumDocuments.addDocument(doc)
    await services.shared.workspace.DocumentBuilder.build([doc], { eagerLinking: true })
    const file = doc.parseResult.value
    Expect.Is(file, AST.isTaoFile)
    const badge = file.statements.filter(AST.isViewDeclaration).find(view => view.name === 'Badge')
    const parameter = badge && AST.parametersOf(badge)[0]
    const word = AST.streamAllContents(file).filter(AST.isLayoutWord).find(candidate => candidate.value === 'Tint')
    Expect(parameter).toBeDefined()
    Expect(word?.$cstNode).toBeDefined()
    Expect(AST.findOwningView(word!)).toBe(badge)
    const clause = AST.streamAllContents(file).filter(AST.isLayoutEntry)
      .find(entry => ASTUtils.colorValues.clauseValueRead(entry)?.value === 'Tint')
    Expect(clause).toBeDefined()
    Expect(ASTUtils.colorValues.clauseValueRead(clause!)).toBe(word)
    Expect(parameter?.inlineType?.name).toBe('Tint')
    const offset = colorSource.lastIndexOf('background Tint') + 'background '.length + 1
    const leaf = Langium.CstUtils.findLeafNodeAtOffset(file.$cstNode!, offset)!
    const declarations = services.language.references.References.findDeclarations(leaf)
    Expect(declarations).toHaveLength(1)
    Expect(declarations[0]).toBe(parameter)
  })

  Test('renames a color parameter through its clause value', async () => {
    const { services } = Parser.createLspContext()
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      colorSource,
      URI.file('/colors/RenameParameter.tao'),
    )
    services.shared.workspace.LangiumDocuments.addDocument(doc)
    await services.shared.workspace.DocumentBuilder.build([doc], { eagerLinking: true })
    const offset = colorSource.lastIndexOf('background Tint') + 'background '.length + 1
    const rename = services.language.lsp.RenameProvider
    Expect(rename).toBeDefined()
    const edit = await rename!.rename(doc, {
      newName: 'Tone',
      position: doc.textDocument.positionAt(offset),
      textDocument: { uri: doc.uri.toString() },
    })
    Expect(applyRename(doc, edit)).toBe(colorSource.replaceAll('Tint', 'Tone'))
  })

  Test('renames a shade through a color argument', async () => {
    const { services } = Parser.createLspContext()
    const source =
      `workspace design Theme { colors { accent #fff { 20 #ccc } } } app Demo { view Main Design Theme } view Main() { render Badge(Tint: accent.20) } view Badge(Tint color) { }`
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString<AST.TaoFile>(
      source,
      URI.file('/colors/Rename.tao'),
    )
    services.shared.workspace.LangiumDocuments.addDocument(doc)
    await services.shared.workspace.DocumentBuilder.build([doc], { eagerLinking: true })
    const offset = source.lastIndexOf('accent.20') + 'accent.'.length
    const leaf = Langium.CstUtils.findLeafNodeAtOffset(doc.parseResult.value.$cstNode!, offset)!
    const design = doc.parseResult.value.statements.find(AST.isDesignDeclaration)!
    const shade = design.block.members.find(AST.isDesignColorsBlock)!.entries[0]!.family!.members[0]!
    const references = services.language.references.References
    const declarations = references.findDeclarations(leaf)
    Expect(declarations).toHaveLength(1)
    Expect(declarations[0]).toBe(shade)
    const refs = references.findReferences(shade, { includeDeclaration: false }).toArray()
    Expect(refs.map(ref => doc.textDocument.getText(ref.segment.range))).toEqual(['20'])

    const rename = services.language.lsp.RenameProvider
    Expect(rename).toBeDefined()
    const edit = await rename!.rename(doc, {
      newName: '30',
      position: doc.textDocument.positionAt(offset),
      textDocument: { uri: doc.uri.toString() },
    })
    Expect(renameSegments(doc, edit)).toEqual(['20', '20'])
    Expect(applyRename(doc, edit)).toBe(source.replace('20 #ccc', '30 #ccc').replace('accent.20', 'accent.30'))
  })

  Test('relinks a color argument after the mounted design changes in the same parser context', async () => {
    const context = Parser.createContext()
    const source = (design: string) => `
      workspace design Light { colors { accent #fff } }
      workspace design Dark { colors { accent #000 } }
      app Demo { view Main Design ${design} }
      view Main() { render Badge(Tint: accent) }
      view Badge(Tint color) { }
    `
    for (const selected of ['Light', 'Dark']) {
      const parsed = await Parser.parseSource(context, source(selected))
      const design = parsed.entry.ast.statements.filter(AST.isDesignDeclaration)
        .find(candidate => candidate.name === selected)!
      const color = design.block.members.find(AST.isDesignColorsBlock)!.entries[0]!
      const argument = AST.streamAllContents(parsed.entry.ast).find(AST.isArgument)?.value
      Expect.Is(argument, AST.isValueReference)
      Expect(argument.target.ref).toBe(color)
    }
  })

  Test('relinks a shared view color argument after an app design edit', async () => {
    await withTaoFiles('tao-color-relink-', {
      'Designs.tao': `
        folder design Light { colors { accent #fff } }
        folder design Dark { colors { accent #000 } }
      `,
      'App.tao': 'app Demo { view Main Design Light }',
      'View.tao': `
        workspace view Main() { render Badge(Tint: accent) }
        view Badge(Tint color) { }
      `,
    }, async paths => {
      const { services } = Parser.createContext()
      const documents = await Promise.all(
        Object.values(paths).map(async path =>
          await services.shared.workspace.LangiumDocumentFactory.fromUri(URI.file(path))
        ),
      )
      documents.forEach(document => services.shared.workspace.LangiumDocuments.addDocument(document))
      AST.rememberVisibleWorkspaceFiles(documents.map(document => document.parseResult.value).filter(AST.isTaoFile))
      await services.shared.workspace.DocumentBuilder.build(documents, { eagerLinking: true })

      const viewUri = URI.file(paths['View.tao']!)
      const designUri = URI.file(paths['Designs.tao']!)
      const linkedColor = (): AST.DesignColorEntry | undefined => {
        const view = services.shared.workspace.LangiumDocuments.getDocument(viewUri)?.parseResult.value
        const argument = AST.isTaoFile(view) ? AST.streamAllContents(view).find(AST.isArgument)?.value : undefined
        return AST.isValueReference(argument) && AST.isDesignColorEntry(argument.target.ref)
          ? argument.target.ref
          : undefined
      }
      const color = (name: string): AST.DesignColorEntry | undefined => {
        const file = services.shared.workspace.LangiumDocuments.getDocument(designUri)?.parseResult.value
        const design = AST.isTaoFile(file)
          ? file.statements.filter(AST.isDesignDeclaration)
            .find(candidate => candidate.name === name)
          : undefined
        return design?.block.members.find(AST.isDesignColorsBlock)?.entries[0]
      }
      Expect(linkedColor() === color('Light')).toBe(true)
      await FS.writeText(paths['App.tao']!, 'app Demo { view Main Design Dark }')
      await services.shared.workspace.DocumentBuilder.update([URI.file(paths['App.tao']!)], [])
      Expect(linkedColor() === color('Dark')).toBe(true)
    })
  })

  Test('offers design colors only where a color argument or default may be expected', async () => {
    const parsed = await Parser.parseCode(`
      workspace design Theme { colors { accent #2f6b4f } }
      app Demo { view Main Design Theme }
      view Main() {
        state Stored = accent
        render Badge(Tint: acent)
      }
      view Badge(Tint color) { render Surface() }
      view Surface() { }
    `)

    Expect(parsed.diagnostics.map(diagnostic => diagnostic.message)).toEqual([
      "No value named 'accent' is in scope.",
      "No value or design color named 'acent' is in scope.",
    ])
  })

  for (const plainFirst of [true, false]) {
    Test(`links a shade to the color that declares it (${plainFirst ? 'plain' : 'rich'} app first)`, async () => {
      const apps = [
        'app First { view Main Design Plain }',
        'app Second { view Main Design Rich }',
      ]
      const parsed = await testParseCode(`
        workspace design Plain { colors { accent #2f6b4f } }
        workspace design Rich { colors { accent #2f6b4f { 20 #cfe3d8 } } }
        ${(plainFirst ? apps : apps.toReversed()).join('\n')}
        view Main() { render Badge(Tint: accent.20) }
        view Badge(Tint color) { }
      `)

      const argument = AST.streamAllContents(parsed.entry.ast).find(AST.isArgument)?.value
      Expect.Is(argument, AST.isMemberAccessExpression)
      Expect.Is(argument.target.ref, AST.isDesignColorEntry)
      Expect(AST.designColorShade(argument.target.ref, 20)).toBeDefined()
    })
  }

  Test('links a color that only a design mounted through a refinement declares', async () => {
    const parsed = await testParseCode(`
      workspace design Light { colors { accent #2f6b4f } }
      workspace design Dark { colors { glow #ffcc00 } }
      app Demo { view Main Design Light }
      app DemoDark = Demo with { Design Dark }
      view Main() { render Badge(Tint: glow) }
      view Badge(Tint color) { }
    `)

    Expect(AST.mountedDesigns([parsed.entry.ast]).map(design => design.name)).toEqual(['Dark', 'Light'])
    const argument = AST.streamAllContents(parsed.entry.ast).find(AST.isArgument)?.value
    Expect.Is(argument, AST.isValueReference)
    Expect.Is(argument.target.ref, AST.isDesignColorEntry)
    Expect(argument.target.ref.name).toBe('glow')
  })

  Test('finds a style declared only by a design mounted through an app refinement', async () => {
    const { services } = Parser.createContext()
    const source = `
      workspace design Light { styles { daylight [pad 8] } }
      workspace design Dark { styles { night [pad 8] } }
      workspace design Unmounted { styles { night [pad 12] } }
      app Demo { view Main Design Light }
      app DemoDark = Demo with { Design Dark }
      view Main() { render Surface() [night] }
      view Surface() { }
    `
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(source, URI.file('/refined/Main.tao'))
    services.shared.workspace.LangiumDocuments.addDocument(doc)
    await services.shared.workspace.DocumentBuilder.build([doc], { eagerLinking: true })

    const file = doc.parseResult.value
    Expect.Is(file, AST.isTaoFile)
    const dark = file.statements.filter(AST.isDesignDeclaration)
      .find(design => design.name === 'Dark')
    const night = dark?.block.members.filter(AST.isDesignStylesBlock).flatMap(block => block.entries)
      .find(entry => entry.name === 'night')
    const word = AST.streamAllContents(file).find(node => AST.isLayoutWord(node) && node.value === 'night')
    Expect(night).toBeDefined()
    Expect(word?.$cstNode).toBeDefined()
    const declarations = services.language.references.References.findDeclarations(word!.$cstNode!)
    Expect(declarations).toHaveLength(1)
    Expect(declarations[0]).toBe(night)
  })
})

type RenameEdit = { changes?: Record<string, readonly Langium.TextEdit[]> } | null | undefined

function renameSegments(document: Langium.LangiumDocument<AST.TaoFile>, edit: RenameEdit): string[] {
  return renameEdits(document, edit).map(change => document.textDocument.getText(change.range)).toSorted()
}

function applyRename(document: Langium.LangiumDocument<AST.TaoFile>, edit: RenameEdit): string {
  let source = document.textDocument.getText()
  for (
    const change of renameEdits(document, edit).toSorted((left, right) =>
      document.textDocument.offsetAt(right.range.start) - document.textDocument.offsetAt(left.range.start)
    )
  ) {
    const start = document.textDocument.offsetAt(change.range.start)
    const end = document.textDocument.offsetAt(change.range.end)
    source = `${source.slice(0, start)}${change.newText}${source.slice(end)}`
  }
  return source
}

function renameEdits(document: Langium.LangiumDocument<AST.TaoFile>, edit: RenameEdit): readonly Langium.TextEdit[] {
  return edit?.changes?.[document.uri.toString()] ?? []
}

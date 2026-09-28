import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { Assert } from '@shared'
import { type CodegenOptions, type Compiled, gen } from '../codegen-util'
import { Compile } from '../Compile'

/** DesignCompiler lowers structured §13 declarations while preserving the absorbed flat ABI. */
export const DesignCompiler = {
  /** DesignDeclaration binds one ordinary Tao design value in its source module scope. */
  DesignDeclaration(declaration: AST.DesignDeclaration, options: CodegenOptions = {}): Compiled {
    const tokens = declaration.block.members.filter(AST.isDesignToken)
    const legacyBundles = declaration.block.members.filter(AST.isDesignBundle)
    const colors = declaration.block.members.filter(AST.isDesignColorsBlock).flatMap(block =>
      block.entries.flatMap(entry => [
        [entry.name, compileColorValue(entry.value)] as const,
        ...(entry.family?.members ?? []).map(member =>
          [`${entry.name}.${member.name}`, compileColorValue(member.value)] as const
        ),
      ])
    )
    const sizes = declaration.block.members.filter(AST.isDesignSizesBlock).flatMap(block => block.entries)
    const text = declaration.block.members.filter(AST.isDesignTextBlock).flatMap(block => block.entries)
    const styles = declaration.block.members.filter(AST.isDesignStylesBlock).flatMap(block => block.entries)
    const screens = declaration.block.members.filter(AST.isDesignScreensBlock).flatMap(block => block.entries)
    return gen`
      ${gen.scopeName(declaration)} = TR.Design.Declaration({
        name: ${gen.jsLiteral(declaration.name)},
        tokens: {
          ${gen.list(tokens, token => gen`${gen.jsLiteral(token.name)}: ${gen.jsLiteral(token.value)},`)}
        },
        colors: {
          ${gen.list(colors, ([name, value]) => gen`${gen.jsLiteral(name)}: ${value},`)}
        },
        sizes: {
          ${gen.list(sizes, entry => gen`${gen.jsLiteral(entry.name)}: ${compileSizeValue(entry.value)},`)}
        },
        screens: [
          ${
      gen.list(screens, entry =>
        gen`{
            name: ${gen.jsLiteral(entry.name)},
            ${entry.threshold === undefined ? '' : gen`below: ${designDimension(entry.threshold)},`}
          },`)
    }
        ],
        bundles: {
          ${gen.list(legacyBundles, bundle => gen`${gen.jsLiteral(bundle.name)}: ${compileDesignSpec(bundle.spec)},`)}
          ${gen.list(text, entry => gen`${gen.jsLiteral(entry.name)}: ${compileDesignSpec(entry.spec)},`)}
          ${gen.list(styles, entry => gen`${gen.jsLiteral(entry.name)}: ${compileDesignSpec(entry.spec)},`)}
        },
        ${
      options.studio === true
        ? gen`sources: {
          ${gen.list(legacyBundles, bundle => gen`${gen.jsLiteral(bundle.name)}: ${designSpecSource(bundle.spec)},`)}
          ${gen.list(text, entry => gen`${gen.jsLiteral(entry.name)}: ${designSpecSource(entry.spec)},`)}
          ${gen.list(styles, entry => gen`${gen.jsLiteral(entry.name)}: ${designSpecSource(entry.spec)},`)}
        },`
        : ''
    }
      })
    `
  },

  /** DesignSpec preserves authored combined-clause order for mounted-app-local runtime resolution. */
  DesignSpec: compileDesignSpec,

  /** DesignSpecSource preserves Studio-only source identity without changing the established Design.Spec ABI. */
  DesignSpecSource: designSpecSource,
} as const

function compileDesignSpec(spec: AST.LayoutClause): Compiled {
  // A clause that reads no value stays one constant array; the common case costs nothing new.
  if (!spec.entries.some(entry => ASTUtils.colorValues.clauseValueRead(entry) !== undefined)) {
    return gen`TR.Design.Spec(${
      gen.jsLiteral(spec.entries.map(entry => normalizeDecidedHead(ASTUtils.layoutEntryValues(entry))))
    })`
  }
  return gen`TR.Design.Spec([${gen.join(spec.entries, compileDesignSpecEntry)}])`
}

/**
 * A value read (`background Tint`) puts the `color` value in the term's place: the design color name
 * it carries, which the mounted design resolves at render, so a derived color follows `Scheme`.
 */
function compileDesignSpecEntry(entry: AST.LayoutEntry): Compiled {
  const values = normalizeDecidedHead(ASTUtils.layoutEntryValues(entry))
  const word = ASTUtils.colorValues.clauseValueRead(entry)
  if (word === undefined) {
    return gen`${gen.jsLiteral(values)}`
  }
  const value = ASTUtils.colorValues.clauseValueNamed(entry, String(ASTUtils.layoutTermValue(word)))
  Assert.defined(value, 'validated clause value names a value in scope')
  const read = gen`${Compile.ValueDeclarationReference(value)}.jsValue`
  // The read is always the first term, right after the head; any condition words follow it.
  const terms = values.map((term, index) => index === 1 ? read : gen`${gen.jsLiteral(term)}`)
  return gen`[${gen.join(terms, term => term)}]`
}

function compileColorValue(value: AST.DesignColorValue): Compiled {
  if (AST.isDesignColorAtom(value)) {
    return compileColorAtom(value)
  }
  return gen`{
    environment: "Scheme",
    expected: ${gen.jsLiteral(value.expected.toLowerCase())},
    kind: "conditional",
    negative: ${compileColorAtom(value.negative)},
    positive: ${compileColorAtom(value.positive)},
  }`
}

function compileColorAtom(atom: AST.DesignColorAtom): Compiled {
  return atom.literal === undefined
    ? gen`{ kind: "reference", path: ${gen.jsLiteral(designPath(atom.path!))} }`
    : gen`${gen.jsLiteral(atom.literal)}`
}

function compileSizeValue(value: AST.DesignSizeExpression): Compiled {
  return gen`{
    left: ${compileSizeAtom(value.left)},
    ${value.right === undefined ? '' : gen`right: ${compileSizeAtom(value.right)},`}
  }`
}

function compileSizeAtom(atom: AST.DesignSizeAtom): Compiled {
  return atom.dimension === undefined
    ? gen`{ kind: "reference", path: ${gen.jsLiteral(designPath(atom.path!))} }`
    : gen`{
      kind: "dimension",
      unit: ${gen.jsLiteral(atom.dimension.unit)},
      value: ${atom.dimension.value},
    }`
}

function designDimension(dimension: AST.DesignDimension): number {
  return dimension.value * (dimension.unit === 'rem' ? 16 : 1)
}

function designPath(path: AST.DesignValuePath): string {
  return [path.head, ...path.segments].join('.')
}

function designSpecSource(spec: AST.LayoutClause): Compiled {
  const owner = spec.$container
  const cst = spec.$cstNode
  const named = AST.isDesignBundle(owner) || AST.isDesignStyleEntry(owner) || AST.isDesignTextEntry(owner)
  const kind = AST.isDesignTextEntry(owner)
    ? 'text-style'
    : AST.isDesignStyleEntry(owner)
    ? 'style'
    : AST.isDesignBundle(owner)
    ? 'legacy-style'
    : AST.isViewDeclaration(owner)
    ? 'declaration'
    : 'inline'
  return gen`{
    kind: ${gen.jsLiteral(kind)},
    ${named ? gen`member: ${gen.jsLiteral(owner.name)},` : ''}
    path: ${gen.jsLiteral(AST.getDocument(spec).uri.path)},
    ${cst === undefined ? '' : gen`end: ${cst.end}, start: ${cst.offset},`}
  }`
}

/** Keeps the current runtime ABI compatible while accepting decided source aliases. */
function normalizeDecidedHead(values: readonly (number | string)[]): readonly (number | string)[] {
  const [head, ...terms] = values
  if (typeof head !== 'string') {
    return values
  }
  const canonicalHead = ASTUtils.design.canonicalVisualHead(head)
  return [canonicalHead, ...terms]
}

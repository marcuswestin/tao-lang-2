import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'

/**
 * studioRectMarkerPrefix opens Snap's private rectangle marker. The marker is a Studio identity
 * carried by the studio-gated `studioRectId`, never an authored test tag, so codegen keeps it out
 * of the public `testTag` a release build ships.
 */
export const studioRectMarkerPrefix = 'studio_rect_'

const studioRectTagPrefix = `#${studioRectMarkerPrefix}`
const studioGeneratedSourceHeader = '// Studio-written generated source. Read-only until moved to a package.'

/** RenderSourceIdentity is the version-bound source locator shared by Studio and test observations. */
export type RenderSourceIdentity = {
  end: number
  renderId: string
  sourcePath: string
  sourceVersion: string
  start: number
}

/** renderSourceIdentity identifies one authored render and the exact source text it came from. */
export function renderSourceIdentity(render: AST.Render): RenderSourceIdentity | undefined {
  const cstNode = render.$cstNode
  if (cstNode === undefined) {
    return undefined
  }
  const document = AST.getDocument(render)
  const sourcePath = document.uri.fsPath
  return {
    end: cstNode.end,
    renderId: `${sourcePath}:${cstNode.offset}:${cstNode.end}`,
    sourcePath,
    sourceVersion: sourceTextVersion(document.textDocument.getText()),
    start: cstNode.offset,
  }
}

/** studioRenderIdentity derives Studio's stable source and Snap identities from one render. */
export function studioRenderIdentity(render: AST.Render, projectRoot: string): {
  elementName: string
  renderId: string
  studioRectId?: string
} | undefined {
  const elementName = ASTUtils.design.standardElementName(render)
  const source = renderSourceIdentity(render)
  if (elementName === undefined || source === undefined) {
    return undefined
  }
  const studioRectId = studioRectIdForRender(render, projectRoot)
  return {
    elementName,
    renderId: source.renderId,
    ...(studioRectId === undefined ? {} : { studioRectId }),
  }
}

/** sourceTextVersion matches Studio's patch-protocol identity without importing the editor package into codegen. */
function sourceTextVersion(text: string): string {
  let fnvHash = 0x811c9dc5
  let mixedHash = 0x9e3779b9
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index)
    fnvHash ^= codeUnit
    fnvHash = Math.imul(fnvHash, 0x01000193) >>> 0
    mixedHash = Math.imul(mixedHash ^ codeUnit, 0x85ebca6b) >>> 0
  }
  return `text-v1:${text.length}:${fnvHash.toString(36).padStart(7, '0')}${mixedHash.toString(36).padStart(7, '0')}`
}

/** studioRectIdForRender decodes the source-safe UTF-16 hex payload emitted by Snap. */
function studioRectIdForRender(render: AST.Render, projectRoot: string): string | undefined {
  const document = AST.getDocument(render)
  const studioRoot = FS.resolvePath('@/studio', projectRoot)
  if (
    !FS.pathIsWithin(document.uri.fsPath, studioRoot)
    || !document.textDocument.getText().startsWith(`${studioGeneratedSourceHeader}\n`)
  ) {
    return undefined
  }
  const tag = AST.attachedTag(render)?.tag
  if (tag === undefined || !tag.startsWith(studioRectTagPrefix)) {
    return undefined
  }
  const encoded = tag.slice(studioRectTagPrefix.length)
  if (encoded.length === 0 || encoded.length % 4 !== 0 || !/^[0-9a-f]+$/i.test(encoded)) {
    return undefined
  }
  let decoded = ''
  for (let index = 0; index < encoded.length; index += 4) {
    decoded += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 4), 16))
  }
  return decoded.length === 0 ? undefined : decoded
}

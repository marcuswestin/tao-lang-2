import { ASTUtils } from '@ast-utils'
import { AST } from '@parser'
import { FS } from '@shared'

const studioRectTagPrefix = '#studio_rect_'
const studioGeneratedSourceHeader = '// Studio-written generated source. Read-only until moved to a package.'

/** studioRenderIdentity derives Studio's stable source and Snap identities from one render. */
export function studioRenderIdentity(render: AST.Render): {
  elementName: string
  renderId: string
  studioRectId?: string
} | undefined {
  const elementName = ASTUtils.standardDesignElementName(render)
  const cstNode = render.$cstNode
  if (elementName === undefined || cstNode === undefined) {
    return undefined
  }
  const studioRectId = studioRectIdForRender(render)
  return {
    elementName,
    renderId: `${AST.getDocument(render).uri.fsPath}:${cstNode.offset}:${cstNode.end}`,
    ...(studioRectId === undefined ? {} : { studioRectId }),
  }
}

/** studioRectIdForRender decodes the source-safe UTF-16 hex payload emitted by Snap. */
export function studioRectIdForRender(render: AST.Render): string | undefined {
  const document = AST.getDocument(render)
  if (
    !FS.slashPath(document.uri.fsPath).includes('/@/studio/')
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

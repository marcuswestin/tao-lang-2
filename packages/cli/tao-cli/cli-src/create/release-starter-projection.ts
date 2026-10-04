import { AST, Parser } from '@parser'
import { Assert, ReleaseCapabilities, type ReleaseProfile } from '@shared'
import type { CreationFiles } from './creation-lowering'

type Edit = { start: number; end: number; replacement: string }

/** Lower generated element defaults to ordinary named styles for the early public phases. */
export function projectStarterRelease(
  files: CreationFiles,
  profile: ReleaseProfile = ReleaseCapabilities.current(),
): CreationFiles {
  if (ReleaseCapabilities.allows('advanced-design', profile)) {
    return files
  }
  const parsed = Object.entries(files).filter(([path]) => path.endsWith('.tao')).map(([path, source]) => {
    const result = Parser.parseSyntax(source)
    Assert(result.errors === 0, 'generated starter source parses before release projection', { path })
    return { path, source, nodes: AST.streamAllContents(result.ast) }
  })
  const rendered = new Set(
    parsed.flatMap(file => file.nodes.filter(AST.isRender).flatMap(node => node.view ? [node.view.$refText] : [])),
  )
  const styles = new Map<string, string>()
  for (const file of parsed) {
    for (const node of file.nodes.filter(AST.isDesignStyleEntry)) {
      if (/^[A-Z]/u.test(node.name) && rendered.has(node.name)) {
        styles.set(node.name, `base${node.name}`)
      }
    }
  }
  const projected = { ...files }
  for (const file of parsed) {
    const edits: Edit[] = []
    for (const node of file.nodes) {
      if (AST.isDesignStyleEntry(node) && /^[A-Z]/u.test(node.name)) {
        const range = node.$cstNode!
        const style = styles.get(node.name)
        edits.push({
          start: range.offset,
          end: style ? range.offset + node.name.length : range.end,
          replacement: style ?? '',
        })
      }
      if (AST.isRender(node) && node.view) {
        const style = styles.get(node.view.$refText)
        if (!style) {
          continue
        }
        if (node.layoutClause) {
          const start = node.layoutClause.$cstNode!.offset + 1
          edits.push({ start, end: start, replacement: `${style}, ` })
        } else {
          const start = node.block?.$cstNode?.offset ?? node.$cstNode!.end
          edits.push({ start, end: start, replacement: node.block ? `[${style}] ` : ` [${style}]` })
        }
      }
    }
    projected[file.path] = edits.sort((left, right) => right.start - left.start).reduce(
      (source, edit) => `${source.slice(0, edit.start)}${edit.replacement}${source.slice(edit.end)}`,
      file.source,
    )
  }
  return projected
}

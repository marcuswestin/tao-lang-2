import { type AST, Langium, Parser } from '@parser'
import { Text } from '@shared'
import { Expect } from '@shared/test'
import SourceActions from '../source-actions-src/source-actions'

/** parseRawDocument parses exact Tao source text into a linked document for source-action tests. */
export async function parseRawDocument(text: string): Promise<AST.Document> {
  return (await Parser.parseCode(text)).document
}

/** parseRawDocumentAt parses exact Tao source text with a concrete source URI. */
export async function parseRawDocumentAt(text: string, path: string): Promise<AST.Document> {
  return (await Parser.parseCode(text, { uri: Langium.URI.file(path) })).document
}

/** parseDocument parses indented Tao test source into a linked document for source-action tests. */
export async function parseDocument(source: string): Promise<AST.Document> {
  return await parseRawDocument(`${Text.stripIndent(source)}\n`)
}

/** testOrganizeSource organizes Tao source and asserts the expected output and idempotency. */
export async function testOrganizeSource(source: string, expected: string): Promise<void> {
  const organized = await SourceActions.organizeSource(await parseDocument(source))

  Expect(organized).toBe(`${Text.stripIndent(expected)}\n`)
  Expect(await SourceActions.organizeSource(await parseRawDocument(organized!))).toBeUndefined()
}

/** testOrganizeSourceUnchanged asserts that organizing already-canonical Tao source produces no edit. */
export async function testOrganizeSourceUnchanged(source: string): Promise<void> {
  Expect(await SourceActions.organizeSource(await parseDocument(source))).toBeUndefined()
}

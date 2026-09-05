import { type AST, Langium } from '@parser'
import { FS, Repo, Text } from '@shared'
import { Expect } from '@shared/test'
import { Workspace } from '@workspace'
import SourceActions, { type SourceActionOptions } from '../source-actions-src/source-actions'

const rawDocumentRoot = import.meta.dir
const rawDocumentPath = FS.resolvePath('__source.tao', rawDocumentRoot)

/** parseRawDocument parses exact Tao source text into a linked document for source-action tests. */
export async function parseRawDocument(text: string): Promise<AST.Document> {
  const workspace = await Workspace.shared(rawDocumentRoot)
  return (await workspace.parseSource(text, Langium.URI.file(rawDocumentPath))).entry.document
}

/** parseRawDocumentAt parses exact Tao source text with a concrete source URI. */
export async function parseRawDocumentAt(text: string, path: string): Promise<AST.Document> {
  const workspace = await Workspace.shared(FS.dirname(path))
  return (await workspace.parseSource(text, Langium.URI.file(path))).entry.document
}

/** parseDocument parses indented Tao test source into a linked document for source-action tests. */
export async function parseDocument(source: string): Promise<AST.Document> {
  return await parseRawDocument(`${Text.stripIndent(source)}\n`)
}

/** testOrganizeSource organizes Tao source and asserts the expected output and idempotency. */
async function testOrganizeSource(source: string, expected: string): Promise<void> {
  const organized = await SourceActions.organizeSource(await parseDocument(source))

  Expect(organized).toBe(`${Text.stripIndent(expected)}\n`)
  Expect(await SourceActions.organizeSource(await parseRawDocument(organized!))).toBeUndefined()
}

/** testOrganizeSourceUnchanged asserts that organizing already-canonical Tao source produces no edit. */
async function testOrganizeSourceUnchanged(source: string): Promise<void> {
  Expect(await SourceActions.organizeSource(await parseDocument(source))).toBeUndefined()
}

/** organizes returns a test callback that asserts canonical organized source. */
export function organizes(source: string, expected: string): () => Promise<void> {
  return async () => await testOrganizeSource(source, expected)
}

/** organized returns a test callback that asserts source is already canonical. */
export function organized(source: string): () => Promise<void> {
  return async () => await testOrganizeSourceUnchanged(source)
}

/** sourceActionOptionsFor returns package-aware reparse options for a source-action document. */
export async function sourceActionOptionsFor(document: AST.Document): Promise<SourceActionOptions> {
  const directory = document.uri.scheme === 'file' ? FS.dirname(document.uri.path) : Repo.resolvePath('.')
  const workspace = await Workspace.shared(await FS.isDirectory(directory) ? directory : Repo.resolvePath('.'))
  return {
    parseUpdatedDocument: async (updatedDocument, text) => {
      return (await workspace.parseSource(text, updatedDocument.uri)).entry.document
    },
  }
}

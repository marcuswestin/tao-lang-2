import { type AST, Langium } from '@parser'
import { FS, Text } from '@shared'
import { Expect } from '@shared/test'
import { Workspace } from '@workspace'
import SourceActions, { type SourceActionOptions } from '../source-actions-src/source-actions'

/** parseRawDocument parses exact Tao source text into a linked document for source-action tests. */
export async function parseRawDocument(text: string): Promise<AST.Document> {
  const workspace = await Workspace.open(FS.repoPath('.'))
  return (await workspace.parseSource(text, Langium.URI.file('/__tao__/source.tao'))).entry.document
}

/** parseRawDocumentAt parses exact Tao source text with a concrete source URI. */
export async function parseRawDocumentAt(text: string, path: string): Promise<AST.Document> {
  const workspace = await Workspace.open(FS.dirname(path))
  return (await workspace.parseSource(text, Langium.URI.file(path))).entry.document
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

/** sourceActionOptionsFor returns package-aware reparse options for a source-action document. */
export async function sourceActionOptionsFor(document: AST.Document): Promise<SourceActionOptions> {
  const directory = document.uri.scheme === 'file' ? FS.dirname(document.uri.path) : FS.repoPath('.')
  const workspace = await Workspace.open(await FS.isDirectory(directory) ? directory : FS.repoPath('.'))
  return {
    parseUpdatedDocument: async (updatedDocument, text) => {
      return (await workspace.parseSource(text, updatedDocument.uri)).entry.document
    },
  }
}

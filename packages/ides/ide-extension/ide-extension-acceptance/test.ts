import { Assert, FS, HCI, Platform, Time } from '@shared'
import * as vscode from 'vscode'

async function until<T>(
  description: string,
  read: () => Promise<T | undefined | false> | T | undefined | false,
): Promise<T> {
  const deadline = Time.nowMs() + 45_000
  while (Time.nowMs() < deadline) {
    const value = await read()
    if (value !== undefined && value !== false) {
      return value
    }
    await Time.sleep(250)
  }
  Assert(false, `${description} before the probe deadline`)
}

async function open(root: string, name: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(FS.resolvePath(name, root)))
  await vscode.window.showTextDocument(document)
  return document
}

function errors(root: string, name: string): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(vscode.Uri.file(FS.resolvePath(name, root)))
    .filter(diagnostic => diagnostic.severity === vscode.DiagnosticSeverity.Error)
}

export async function run(): Promise<void> {
  const root: string | undefined = Platform.runtimeProcess.env['TAO_EDITOR_ACCEPTANCE_ROOT']
  const identity: string | undefined = Platform.runtimeProcess.env['TAO_EDITOR_EXPECTED_EXTENSION']
  const version: string | undefined = Platform.runtimeProcess.env['TAO_EDITOR_EXPECTED_VERSION']
  const extensionsDir: string | undefined = Platform.runtimeProcess.env['TAO_EDITOR_EXTENSIONS_DIR']
  const marker: string | undefined = Platform.runtimeProcess.env['TAO_EDITOR_ACCEPTANCE_MARKER']
  const progress: string | undefined = Platform.runtimeProcess.env['TAO_EDITOR_ACCEPTANCE_PROGRESS']
  Assert.defined(root, 'the probe workspace path')
  Assert.defined(identity, 'the installed extension identity')
  Assert.defined(version, 'the installed extension version')
  Assert.defined(extensionsDir, 'the isolated extensions directory')
  Assert.defined(marker, 'the probe result path')
  Assert.defined(progress, 'the probe progress path')
  const phase = async (index: number, name: string): Promise<void> => {
    await FS.writeJson(FS.resolvePath(`${index}-${name}.json`, progress), { phase: name, at: new Date().toISOString() })
    HCI.writeLine(`TAO_EDITOR_ACCEPTANCE_PHASE ${name}`)
  }
  await phase(0, 'started')
  Assert(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath === root, 'the isolated Tao workspace to open')

  await phase(1, 'activation')
  const statePath = FS.resolvePath('probe-state.json', FS.dirname(marker))
  let previousRegistry = ''
  const registeredExtension = async (): Promise<vscode.Extension<unknown> | undefined> => {
    const extensions = vscode.extensions.all.map(candidate => ({
      id: candidate.id,
      path: candidate.extensionPath,
      version: String(candidate.packageJSON.version ?? ''),
      active: candidate.isActive,
    }))
    const languages = await vscode.languages.getLanguages()
    const trusted = vscode.workspace.isTrusted
    const registry = JSON.stringify({ extensions, languages, trusted })
    if (registry !== previousRegistry) {
      await FS.writeJson(statePath, { expected: identity, version, extensions, languages, trusted })
      previousRegistry = registry
    }
    return vscode.extensions.getExtension(identity)
  }
  await registeredExtension()
  Assert(vscode.workspace.isTrusted, 'the isolated editor workspace to be trusted')
  const extension = await until('installed Tao registration', registeredExtension)
  Assert(extension.packageJSON.version === version, 'the installed Tao version to match the VSIX')
  Assert(
    FS.pathIsWithin(extension.extensionPath, extensionsDir),
    `the Tao extension to load from ${extensionsDir}`,
  )
  const main = await open(root, 'Main.tao')
  Assert(main.languageId === 'tao', 'VS Code to recognize the Tao language')
  await until('installed Tao activation', () => extension.isActive)

  const offset = main.getText().lastIndexOf('Greeting')
  Assert(offset >= 0, 'a Greeting reference in Main.tao')
  const position = main.positionAt(offset + 2)
  await phase(2, 'hover')
  const hoverStatePath = FS.resolvePath('hover-state.json', FS.dirname(marker))
  let previousHoverState = ''
  await until('Tao hover', async () => {
    const items = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      main.uri,
      position,
    )
    const diagnostics = errors(root, 'Main.tao')
    const hoverState = {
      documentUri: main.uri.toString(),
      languageId: main.languageId,
      position: { line: position.line, character: position.character },
      itemCount: items?.length ?? null,
      items: items === undefined ? null : items.slice(0, 8).map(item => ({
        contents: item.contents.slice(0, 8).map(content =>
          (typeof content === 'string' ? content : content.value).slice(0, 4_000)
        ),
        range: item.range === undefined ? null : {
          start: { line: item.range.start.line, character: item.range.start.character },
          end: { line: item.range.end.line, character: item.range.end.character },
        },
      })),
      errorCount: diagnostics.length,
      errors: diagnostics.slice(0, 16).map(diagnostic => ({
        message: diagnostic.message.slice(0, 2_000),
        range: {
          start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
          end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character },
        },
      })),
    }
    const serialized = JSON.stringify(hoverState)
    if (serialized !== previousHoverState) {
      await FS.writeJson(hoverStatePath, hoverState)
      previousHoverState = serialized
    }
    return items?.some(item =>
        item.contents.some(content =>
          (typeof content === 'string' ? content : content.value).includes('A greeting declared in another Tao file.')
        )
      )
      ? items
      : undefined
  })
  await phase(3, 'definitions')
  await until('cross-file Tao definition', async () => {
    const items = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      main.uri,
      position,
    )
    return items?.some(item =>
        ('uri' in item ? item.uri : item.targetUri).fsPath
          === FS.resolvePath('Definitions.tao', root)
      )
      ? items
      : undefined
  })

  await phase(4, 'contracts')
  const generated = FS.resolvePath('.tao-ts/Functions.tao.ts', root)
  await until(
    'disk-published TypeScript contract',
    async () => await FS.isFile(generated) && (await FS.readText(generated)).includes('CountWords'),
  )
  await phase(5, 'origin')
  const generatedDocument = await open(root, '.tao-ts/Functions.tao.ts')
  const link = await until('generated declaration source link', async () => {
    const items = await vscode.commands.executeCommand<vscode.DocumentLink[]>(
      'vscode.executeLinkProvider',
      generatedDocument.uri,
    )
    return items?.find(item => item.target?.toString().startsWith('command:tao.openSourceOrigin?'))
  })
  Assert.defined(link.target, 'a source origin command target')
  const target = link.target.toString()
  const args: unknown = JSON.parse(decodeURIComponent(target.slice(target.indexOf('?') + 1)))
  Assert(Array.isArray(args) && args.length === 2, 'a source path and range in the origin link')
  const [sourcePath, sourceRange] = args as [string, {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }]
  Assert(sourcePath === FS.resolvePath('Functions.tao', root), 'the origin link to target Functions.tao')
  await vscode.commands.executeCommand('tao.openSourceOrigin', sourcePath, sourceRange)
  const editor = vscode.window.activeTextEditor
  Assert.defined(editor, 'an active Tao source editor after opening the origin')
  Assert(editor.document.uri.fsPath === sourcePath, 'the exact origin Tao document to open')
  const selected = editor.selection
  Assert(
    selected.start.line === sourceRange.start.line && selected.start.character === sourceRange.start.character
      && selected.end.line === sourceRange.end.line && selected.end.character === sourceRange.end.character,
    'the source origin selection to match the generated link range',
  )

  await phase(6, 'Tao diagnostics')
  const broken = FS.resolvePath('Broken.tao', root)
  await FS.writeText(broken, 'let Broken = Missing\n')
  const brokenDocument = await open(root, 'Broken.tao')
  await until(
    'current Tao error diagnostic',
    () => errors(root, 'Broken.tao').some(diagnostic => diagnostic.message.includes('Missing')),
  )
  const correction = new vscode.WorkspaceEdit()
  correction.replace(
    brokenDocument.uri,
    new vscode.Range(brokenDocument.positionAt(0), brokenDocument.positionAt(brokenDocument.getText().length)),
    'let Broken = "repaired"\n',
  )
  Assert(await vscode.workspace.applyEdit(correction), 'the Tao correction to apply')
  Assert(await brokenDocument.save(), 'the Tao correction to save')
  await until(
    'cleared Tao error diagnostic',
    () => !errors(root, 'Broken.tao').some(diagnostic => diagnostic.message.includes('Missing')),
  )

  await phase(7, 'sidecar')
  const sidecar = FS.resolvePath('Words.ts', root)
  await FS.writeText(sidecar, 'export function CountWords(value: string): string { return value }\n')
  const signatureError = (): boolean =>
    errors(root, 'Functions.tao').some(diagnostic =>
      String(diagnostic.code) === 'TS1360' || diagnostic.message.includes('TypeScript:')
    )
  await until('TypeScript sidecar signature diagnostic', signatureError)
  await phase(8, 'recovery')
  await FS.writeText(sidecar, 'export function CountWords(value: string): number { return value.length }\n')
  await until('cleared TypeScript sidecar diagnostic', () => !signatureError())
  await FS.writeJson(marker, { result: 'passed', extension: identity, version })
  HCI.writeLine('TAO_EDITOR_ACCEPTANCE_PASSED')
}

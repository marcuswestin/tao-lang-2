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
  Assert.defined(root, 'the probe workspace path')
  Assert.defined(identity, 'the installed extension identity')
  Assert.defined(version, 'the installed extension version')
  Assert.defined(extensionsDir, 'the isolated extensions directory')
  Assert.defined(marker, 'the probe result path')
  Assert(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath === root, 'the isolated Tao workspace to open')

  const main = await open(root, 'Main.tao')
  Assert(main.languageId === 'tao', 'VS Code to recognize the Tao language')
  const extension = await until('installed Tao activation', () => {
    const candidate = vscode.extensions.getExtension(identity)
    return candidate?.isActive ? candidate : undefined
  })
  Assert(extension.packageJSON.version === version, 'the installed Tao version to match the VSIX')
  Assert(
    FS.pathIsWithin(extension.extensionPath, extensionsDir),
    `the Tao extension to load from ${extensionsDir}`,
  )

  const offset = main.getText().lastIndexOf('Greeting')
  Assert(offset >= 0, 'a Greeting reference in Main.tao')
  const position = main.positionAt(offset + 2)
  await until('Tao hover', async () => {
    const items = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      main.uri,
      position,
    )
    return items?.some(item => JSON.stringify(item.contents).includes('A greeting declared in another Tao file.'))
      ? items
      : undefined
  })
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

  const generated = FS.resolvePath('.tao-ts/Functions.tao.ts', root)
  await until(
    'disk-published TypeScript contract',
    async () => await FS.isFile(generated) && (await FS.readText(generated)).includes('CountWords'),
  )
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

  const sidecar = FS.resolvePath('Words.ts', root)
  await FS.writeText(sidecar, 'export function CountWords(value: string): string { return value }\n')
  const signatureError = (): boolean =>
    errors(root, 'Functions.tao').some(diagnostic =>
      String(diagnostic.code) === 'TS1360' || diagnostic.message.includes('TypeScript:')
    )
  await until('TypeScript sidecar signature diagnostic', signatureError)
  await FS.writeText(sidecar, 'export function CountWords(value: string): number { return value.length }\n')
  await until('cleared TypeScript sidecar diagnostic', () => !signatureError())
  await FS.writeJson(marker, { result: 'passed', extension: identity, version })
  HCI.writeLine('TAO_EDITOR_ACCEPTANCE_PASSED')
}

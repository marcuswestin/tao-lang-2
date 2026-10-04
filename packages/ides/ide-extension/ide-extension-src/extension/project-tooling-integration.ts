import { findProjectRoot, ProjectTooling, type ProjectToolingResult } from '@project-tooling'
import { type DiagnosticRange, Errors, FS } from '@shared'
import * as vscode from 'vscode'
import {
  hideToolingPatterns,
  originCommandUri,
  originMappingsForPath,
  showToolingPatterns,
  toolingExplorerPatterns,
} from './project-tooling-presentation'
import { createProjectToolingSession } from './project-tooling-session'

type Session = ReturnType<typeof createProjectToolingSession>

/** Connect disk-backed contracts to Explorer, diagnostics, and exact source links. */
export async function startProjectTooling(context: vscode.ExtensionContext): Promise<() => Promise<void>> {
  const diagnostics = vscode.languages.createDiagnosticCollection('tao-project-tooling')
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)
  const output = vscode.window.createOutputChannel('Tao Project Tooling')
  const publishedPaths = new Map<string, string[]>()
  const ownedExclusions = new Map<string, Set<string>>()
  const subscriptions: vscode.Disposable[] = [diagnostics, status, output]
  let session: Session
  let stopped = false
  let discovery: Promise<void> = Promise.resolve()
  const reportFailure = (error: unknown): void => {
    const message = `Could not update Tao project tooling: ${Errors.messageOf(error)}`
    output.appendLine(message)
    void vscode.window.showErrorMessage(message)
  }

  const updateStatus = async (): Promise<void> => {
    const root = await activeProjectRoot(session) ?? session.roots()[0]
    const result = root === undefined ? undefined : session.result(root)
    if (result === undefined) {
      status.hide()
      return
    }
    status.text = result.status === 'fresh' ? '$(check) Tao contracts fresh' : '$(warning) Tao contracts stale'
    status.tooltip = result.status === 'fresh'
      ? `Tao TypeScript contracts are current (revision ${result.revision}).`
      : `Tao TypeScript contracts are stale. ${
        result.diagnostics.filter(item => item.severity === 'error').map(item => item.message).join('\n')
      }`
    status.command = 'tao.openTypeScriptConfig'
    status.show()
  }

  session = createProjectToolingSession(
    ProjectTooling.watch,
    result => {
      publishDiagnostics(diagnostics, publishedPaths, result)
      void updateStatus().catch(reportFailure)
    },
    root => {
      for (const path of publishedPaths.get(root) ?? []) {
        diagnostics.delete(vscode.Uri.file(path))
      }
      publishedPaths.delete(root)
      void updateStatus().catch(reportFailure)
    },
    (root, error) => {
      const message = `Could not refresh Tao project ${root}: ${Errors.messageOf(error)}`
      output.appendLine(message)
      void vscode.window.showErrorMessage(message)
    },
    {
      hostModulesRoot: context.asAbsolutePath('_gen_ide-extension/host/node_modules'),
      runtimeRoot: context.asAbsolutePath('_gen_ide-extension/runtime'),
    },
  )

  const discover = (): Promise<void> => {
    discovery = discovery.catch(() => undefined).then(async () => {
      if (stopped) {
        return
      }
      const roots = await discoverProjectRoots()
      await session.reconcile(roots)
      await reconcileExplorerExclusions(roots, ownedExclusions)
      await updateStatus()
    })
    return discovery
  }
  const scheduleDiscovery = (): void => {
    void discover().catch(reportFailure)
  }

  subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    scheduleDiscovery()
  }))
  subscriptions.push(vscode.window.onDidChangeActiveTextEditor(() => {
    void updateStatus().catch(reportFailure)
  }))
  const sourceFiles = vscode.workspace.createFileSystemWatcher('**/*.tao')
  subscriptions.push(sourceFiles)
  subscriptions.push(sourceFiles.onDidCreate(() => {
    scheduleDiscovery()
  }))
  subscriptions.push(sourceFiles.onDidDelete(() => {
    scheduleDiscovery()
  }))
  subscriptions.push(vscode.commands.registerCommand('tao.showTooling', async () => {
    const project = await chooseProjectRoot(session)
    if (project === undefined) {
      return
    }
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(project))
    if (folder === undefined) {
      return
    }
    const patterns = toolingExplorerPatterns(folder.uri.fsPath, project)
    const config = vscode.workspace.getConfiguration('files', folder.uri)
    const current = config.inspect<Record<string, boolean>>('exclude')?.workspaceFolderValue ?? {}
    await config.update('exclude', showToolingPatterns(current, patterns), vscode.ConfigurationTarget.WorkspaceFolder)
    for (const pattern of patterns) {
      ownedExclusions.get(folder.uri.fsPath)?.delete(pattern)
    }
  }))
  subscriptions.push(vscode.commands.registerCommand('tao.openTypeScriptConfig', async () => {
    const project = await chooseProjectRoot(session)
    if (project === undefined) {
      return
    }
    await vscode.window.showTextDocument(vscode.Uri.file(FS.resolvePath('tsconfig.json', project)))
  }))
  subscriptions.push(vscode.commands.registerCommand('tao.openSourceOrigin', async (
    sourcePath: string,
    sourceRange: DiagnosticRange,
  ) => {
    await vscode.window.showTextDocument(vscode.Uri.file(sourcePath), {
      selection: toRange(sourceRange),
    })
  }))
  subscriptions.push(vscode.languages.registerDocumentLinkProvider(
    [{ scheme: 'file', language: 'typescript' }, { scheme: 'file', language: 'typescriptreact' }],
    {
      provideDocumentLinks(document) {
        const links: vscode.DocumentLink[] = []
        for (const root of publishedPaths.keys()) {
          const result = session.result(root)
          if (result === undefined || !result.contractPaths.includes(document.uri.fsPath)) {
            continue
          }
          for (const mapping of originMappingsForPath(document.uri.fsPath, result.sourceMappings)) {
            const target = vscode.Uri.parse(originCommandUri(mapping.sourcePath, mapping.sourceRange))
            const link = new vscode.DocumentLink(toRange(mapping.generatedRange), target)
            link.tooltip = result.status === 'stale' ? 'Open Tao origin (contracts stale)' : 'Open Tao origin'
            links.push(link)
          }
        }
        return links
      },
    },
  ))

  await discover()
  return async () => {
    stopped = true
    for (const subscription of subscriptions) {
      subscription.dispose()
    }
    await discovery.catch(() => undefined)
    await session.dispose()
  }
}

async function discoverProjectRoots(): Promise<string[]> {
  const candidates = new Set<string>()
  const folders = vscode.workspace.workspaceFolders ?? []
  for (const folder of folders) {
    candidates.add(folder.uri.fsPath)
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/*.tao'),
      '**/{node_modules,.tao-ts,.git,.artifacts}/**',
    )
    for (const file of files) {
      candidates.add(file.fsPath)
    }
  }
  const found = await Promise.all([...candidates].map(async path => await findProjectRoot(path)))
  return [...new Set(found.filter((root): root is string => root !== undefined))]
}

async function activeProjectRoot(session: Session): Promise<string | undefined> {
  const uri = vscode.window.activeTextEditor?.document.uri
  const path = uri?.scheme === 'file' ? uri.fsPath : undefined
  const active = path === undefined ? undefined : await findProjectRoot(path)
  return active !== undefined && session.result(active) !== undefined ? active : undefined
}

async function chooseProjectRoot(session: Session): Promise<string | undefined> {
  const active = await activeProjectRoot(session)
  if (active !== undefined && session.result(active) !== undefined) {
    return active
  }
  const roots = session.roots()
  if (roots.length === 1) {
    return roots[0]
  }
  return await vscode.window.showQuickPick(roots, { placeHolder: 'Choose a Tao project' })
}

async function reconcileExplorerExclusions(
  roots: readonly string[],
  owned: Map<string, Set<string>>,
): Promise<void> {
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const folderPath = folder.uri.fsPath
    const wanted = new Set(roots.flatMap(root => toolingExplorerPatterns(folderPath, root)))
    const config = vscode.workspace.getConfiguration('files', folder.uri)
    const current = config.inspect<Record<string, boolean>>('exclude')?.workspaceFolderValue ?? {}
    const ours = owned.get(folderPath) ?? new Set<string>()
    const next = { ...current }
    for (const pattern of ours) {
      if (!wanted.has(pattern) && next[pattern] === true) {
        delete next[pattern]
      }
    }
    for (const pattern of wanted) {
      if (!Object.hasOwn(next, pattern)) {
        ours.add(pattern)
      }
    }
    const hidden = hideToolingPatterns(next, [...wanted])
    if (JSON.stringify(current) !== JSON.stringify(hidden)) {
      await config.update('exclude', hidden, vscode.ConfigurationTarget.WorkspaceFolder)
    }
    owned.set(folderPath, new Set([...ours].filter(pattern => wanted.has(pattern))))
  }
}

function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  pathsByRoot: Map<string, string[]>,
  result: ProjectToolingResult,
): void {
  for (const path of pathsByRoot.get(result.root) ?? []) {
    collection.delete(vscode.Uri.file(path))
  }
  const byPath = new Map<string, vscode.Diagnostic[]>()
  for (const item of result.diagnostics) {
    const path = item.filePath ?? FS.resolvePath('tsconfig.json', result.root)
    const range = item.range === undefined ? new vscode.Range(0, 0, 0, 0) : toRange(item.range)
    const severity = item.severity === 'error'
      ? vscode.DiagnosticSeverity.Error
      : item.severity === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : item.severity === 'information'
      ? vscode.DiagnosticSeverity.Information
      : vscode.DiagnosticSeverity.Hint
    const diagnostic = new vscode.Diagnostic(range, item.message, severity)
    diagnostic.source = result.status === 'stale' ? 'Tao tooling (stale contracts)' : 'Tao tooling'
    diagnostic.code = item.code
    byPath.set(path, [...(byPath.get(path) ?? []), diagnostic])
  }
  for (const [path, items] of byPath) {
    collection.set(vscode.Uri.file(path), items)
  }
  pathsByRoot.set(result.root, [...byPath.keys()])
}

function toRange(range: DiagnosticRange): vscode.Range {
  return new vscode.Range(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character,
  )
}

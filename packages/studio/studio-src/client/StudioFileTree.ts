import type {
  StudioCreateFileResult,
  StudioDeleteFileResult,
  StudioRenameFileResult,
} from '../StudioProjectSession'
import { StudioApiClient, StudioApiError, type StudioFile } from './StudioApiClient'

export type StudioFileTreeFolder = {
  children: readonly StudioFileTreeNode[]
  kind: 'folder'
  name: string
  path: string
}

export type StudioFileTreeLeaf = {
  file: StudioFile
  kind: 'file'
  name: string
}

export type StudioFileTreeNode = StudioFileTreeFolder | StudioFileTreeLeaf

type StudioFileTreeApi = Pick<
  typeof StudioApiClient,
  'createFile' | 'deleteFile' | 'files' | 'renameFile'
>

export type StudioFileTreeOptions = {
  activePath?: () => string | undefined
  api?: StudioFileTreeApi
  confirm?: (message: string) => boolean
  files: readonly StudioFile[]
  onCreated?: (result: StudioCreateFileResult) => Promise<void> | void
  onDeleted?: (result: StudioDeleteFileResult) => Promise<void> | void
  onError?: (error: unknown) => void
  onFiles?: (files: readonly StudioFile[]) => void
  onOpen: (file: StudioFile) => void
  onRenamed?: (result: StudioRenameFileResult) => Promise<void> | void
  prepareMutation?: (file: StudioFile) => Promise<StudioFile | undefined>
  prompt?: (message: string, initial: string) => string | null
  protectedPath?: string
  renderDom?: boolean
}

export type MountedStudioFileTree = Readonly<{
  create: (path: string) => Promise<void>
  delete: (path: string, sourceVersion: string) => Promise<void>
  refresh: () => Promise<void>
  rename: (path: string, sourceVersion: string, targetPath: string) => Promise<void>
  render: () => void
  setFiles: (files: readonly StudioFile[]) => void
}>

export const StudioFileTreeModel = {
  build(files: readonly StudioFile[]): readonly StudioFileTreeNode[] {
    const root = mutableFolder('', '')
    for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
      const parts = file.path.split('/').filter(Boolean)
      let folder = root
      for (const name of parts.slice(0, -1)) {
        const existing = folder.children.find(candidate => candidate.kind === 'folder' && candidate.name === name)
        if (existing?.kind === 'folder') {
          folder = existing as MutableFolder
        } else {
          const child = mutableFolder(name, folder.path === '' ? name : `${folder.path}/${name}`)
          folder.children.push(child)
          folder = child
        }
      }
      folder.children.push({ file, kind: 'file', name: parts.at(-1) ?? file.path })
    }
    sortFolders(root)
    return root.children
  },
  deletePrompt(path: string): string {
    return `Delete ${path}? This cannot be undone.`
  },
  validatePath(input: string): string {
    const path = input.trim()
    const parts = path.split('/')
    if (
      path === ''
      || path.startsWith('/')
      || path.includes('\\')
      || parts.some(part => part === '' || part === '.' || part === '..')
      || !path.endsWith('.tao')
    ) {
      throw new Error('Enter a project-relative .tao file path without empty, . or .. segments.')
    }
    return path
  },
} as const

export const StudioFileTreeTransitions = {
  afterCreate(result: StudioCreateFileResult): string {
    return result.file.path
  },
  afterDelete(activePath: string | undefined, entryPath: string, result: StudioDeleteFileResult): string | undefined {
    return activePath === result.deleted.path ? entryPath : activePath
  },
  afterRename(activePath: string | undefined, result: StudioRenameFileResult): string | undefined {
    return activePath === result.previousPath ? result.file.path : activePath
  },
} as const

export class StudioFileTreeController {
  readonly #api: StudioFileTreeApi
  readonly #options: StudioFileTreeOptions
  #files: readonly StudioFile[]

  constructor(options: StudioFileTreeOptions) {
    this.#api = options.api ?? StudioApiClient
    this.#files = options.files
    this.#options = options
  }

  get files(): readonly StudioFile[] {
    return this.#files
  }

  async create(input: string): Promise<StudioCreateFileResult> {
    const result = await this.#api.createFile({
      path: StudioFileTreeModel.validatePath(input),
      writeId: writeId('create'),
    })
    this.setFiles(result.files)
    await this.#options.onCreated?.(result)
    return result
  }

  async delete(file: StudioFile): Promise<StudioDeleteFileResult | undefined> {
    const current = await this.#prepare(file)
    if (current === undefined) {
      return undefined
    }
    const result = await this.#api.deleteFile({
      path: current.path,
      sourceVersion: current.sourceVersion,
      writeId: writeId('delete'),
    })
    this.setFiles(result.files)
    await this.#options.onDeleted?.(result)
    return result
  }

  async refresh(): Promise<void> {
    this.setFiles((await this.#api.files()).files)
  }

  async rename(file: StudioFile, input: string): Promise<StudioRenameFileResult | undefined> {
    const targetPath = StudioFileTreeModel.validatePath(input)
    if (targetPath === file.path) {
      return undefined
    }
    const current = await this.#prepare(file)
    if (current === undefined) {
      return undefined
    }
    const result = await this.#api.renameFile({
      path: current.path,
      sourceVersion: current.sourceVersion,
      targetPath,
      writeId: writeId('rename'),
    })
    this.setFiles(result.files)
    await this.#options.onRenamed?.(result)
    return result
  }

  setFiles(files: readonly StudioFile[]): void {
    this.#files = files
    this.#options.onFiles?.(files)
  }

  async #prepare(file: StudioFile): Promise<StudioFile | undefined> {
    return this.#options.prepareMutation === undefined
      ? file
      : await this.#options.prepareMutation(file)
  }
}

/** Mounts the isolated file-tree slice. StudioApp can adopt it without owning file mutation details. */
export function mountStudioFileTree(
  parent: HTMLElement,
  options: StudioFileTreeOptions,
): MountedStudioFileTree {
  const root = document.createElement('section')
  root.className = 'studio-file-tree'
  const renderDom = options.renderDom !== false
  const confirm = options.confirm ?? (message => window.confirm(message))
  const prompt = options.prompt ?? ((message, initial) => window.prompt(message, initial))
  const controller = new StudioFileTreeController({
    ...options,
    onFiles(files) {
      options.onFiles?.(files)
      if (renderDom) {
        render()
      }
    },
  })
  const run = (action: () => Promise<unknown>): void => {
    void action().catch(error => options.onError?.(error))
  }

  const render = (): void => {
    root.replaceChildren()
    const toolbar = document.createElement('div')
    toolbar.className = 'studio-file-tree__toolbar'
    const create = button('New Tao file', () => {
      const path = prompt('New Tao file path', 'New.tao')
      if (path !== null) {
        run(async () => await controller.create(path))
      }
    })
    toolbar.append(create)
    root.append(toolbar, renderNodes(StudioFileTreeModel.build(controller.files)))
  }

  const renderNodes = (nodes: readonly StudioFileTreeNode[]): HTMLElement => {
    const list = document.createElement('ul')
    list.className = 'studio-file-tree__list'
    for (const node of nodes) {
      const item = document.createElement('li')
      if (node.kind === 'folder') {
        const disclosure = document.createElement('details')
        disclosure.open = true
        const summary = document.createElement('summary')
        summary.textContent = node.name
        disclosure.append(summary, renderNodes(node.children))
        item.append(disclosure)
      } else {
        const open = button(node.name, () => options.onOpen(node.file))
        open.className = 'studio-file studio-file-tree__file'
        open.dataset['path'] = node.file.path
        if (options.activePath?.() === node.file.path) {
          open.setAttribute('aria-current', 'true')
        }
        if (node.file.dirty) {
          const dirty = document.createElement('span')
          dirty.className = 'studio-file-tree__dirty'
          dirty.title = 'Unsaved draft'
          dirty.textContent = '●'
          item.append(dirty)
        }
        item.append(open)
        if (node.file.diagnosticCount > 0) {
          const badge = document.createElement('span')
          badge.className = 'studio-file-tree__diagnostics'
          badge.title = `${node.file.diagnosticCount} diagnostic${node.file.diagnosticCount === 1 ? '' : 's'}`
          badge.textContent = String(node.file.diagnosticCount)
          item.append(badge)
        }
        const rename = button('Rename', () => {
          const targetPath = prompt('Rename Tao file', node.file.path)
          if (targetPath !== null) {
            run(async () => await controller.rename(node.file, targetPath))
          }
        })
        rename.className = 'studio-file-tree__action'
        const remove = button('Delete', () => {
          if (confirm(StudioFileTreeModel.deletePrompt(node.file.path))) {
            run(async () => await controller.delete(node.file))
          }
        })
        remove.className = 'studio-file-tree__action studio-file-tree__action--delete'
        rename.disabled = options.protectedPath === node.file.path
        remove.disabled = options.protectedPath === node.file.path
        item.append(rename, remove)
      }
      list.append(item)
    }
    return list
  }

  if (renderDom) {
    parent.append(root)
    render()
  }
  return {
    async create(path) {
      await controller.create(path)
    },
    async delete(path, sourceVersion) {
      await controller.delete(currentFile(path, sourceVersion))
    },
    refresh: async () => await controller.refresh(),
    async rename(path, sourceVersion, targetPath) {
      await controller.rename(currentFile(path, sourceVersion), targetPath)
    },
    render,
    setFiles(files) {
      controller.setFiles(files)
    },
  }

  function currentFile(path: string, sourceVersion: string): StudioFile {
    const file = controller.files.find(candidate => candidate.path === path)
    if (file === undefined) {
      throw new Error(`Tao Studio file is no longer available: ${path}`)
    }
    if (file.sourceVersion !== sourceVersion) {
      throw new StudioApiError('This file changed under this edit.', 409)
    }
    return file
  }
}

type MutableFolder = {
  children: StudioFileTreeNode[]
  kind: 'folder'
  name: string
  path: string
}

function mutableFolder(name: string, path: string): MutableFolder {
  return { children: [], kind: 'folder', name, path }
}

function sortFolders(folder: MutableFolder): void {
  for (const child of folder.children) {
    if (child.kind === 'folder') {
      sortFolders(child as MutableFolder)
    }
  }
  folder.children.sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'folder' ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })
}

function button(label: string, action: () => void): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.textContent = label
  element.addEventListener('click', action)
  return element
}

function writeId(action: string): string {
  return `file-${action}-${crypto.randomUUID()}`
}

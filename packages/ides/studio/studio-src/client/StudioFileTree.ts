import { Assert, Errors } from '@shared/core'
import type {
  StudioCreateFileResult,
  StudioDeleteFileResult,
  StudioRenameFileResult,
} from '../StudioProjectSession'
import { StudioApiClient, StudioApiError, type StudioFile } from './StudioApiClient'

type StudioFileTreeApi = Pick<
  typeof StudioApiClient,
  'createFile' | 'deleteFile' | 'files' | 'renameFile'
>

export type StudioFileTreeOptions = {
  api?: StudioFileTreeApi
  files: readonly StudioFile[]
  onCreated?: (result: StudioCreateFileResult) => Promise<void> | void
  onDeleted?: (result: StudioDeleteFileResult) => Promise<void> | void
  onFiles?: (files: readonly StudioFile[]) => void
  onRenamed?: (result: StudioRenameFileResult) => Promise<void> | void
  prepareMutation?: (file: StudioFile) => Promise<StudioFile | undefined>
}

export type MountedStudioFileTree = Readonly<{
  create: (path: string) => Promise<void>
  delete: (path: string, sourceVersion: string) => Promise<void>
  refresh: () => Promise<void>
  rename: (path: string, sourceVersion: string, targetPath: string) => Promise<void>
  setFiles: (files: readonly StudioFile[]) => void
}>

export const StudioFileTreeModel = {
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
      Errors.throwUserInput('Enter a project-relative .tao file path without empty, . or .. segments.')
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
export function mountStudioFileTree(options: StudioFileTreeOptions): MountedStudioFileTree {
  const controller = new StudioFileTreeController(options)

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
    setFiles(files) {
      controller.setFiles(files)
    },
  }

  function currentFile(path: string, sourceVersion: string): StudioFile {
    const file = controller.files.find(candidate => candidate.path === path)
    Assert.input(file, `Tao Studio file is no longer available: ${path}`)
    if (file.sourceVersion !== sourceVersion) {
      throw new StudioApiError('This file changed under this edit.', 409)
    }
    return file
  }
}

function writeId(action: string): string {
  return `file-${action}-${crypto.randomUUID()}`
}

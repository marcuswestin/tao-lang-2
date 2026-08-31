import React from 'react'
import { createPortal } from 'react-dom'
import { mountStudio } from './client/StudioApp'
import {
  rejectPendingStudioProductHostActions,
  requestStudioProductHostCreateFile,
  requestStudioProductHostDeleteFile,
  requestStudioProductHostOpenFile,
  requestStudioProductHostRenameFile,
} from './StudioProductHostProtocol'

export type TaoStudioProductHostProps = Readonly<{
  children?: React.ReactNode
  Layout?: Readonly<{ style?: React.CSSProperties }>
  Tag?: string
}>

/** ProductHostBoundary is the single foreign seam between Tao-owned navigation and the product workbench. */
export function ProductHostBoundary(props: TaoStudioProductHostProps): React.ReactElement {
  const mount = React.useRef<HTMLDivElement>(null)
  const [filesTarget, setFilesTarget] = React.useState<HTMLElement>()
  React.useEffect(() => {
    const root = mount.current
    if (root === null) {
      return
    }
    let cleanup: (() => void) | undefined
    let unmounted = false
    const mounting = mountStudio({ embedded: true, root })
    const reportMountError = (error: unknown): void => {
      rejectPendingStudioProductHostActions(error)
      console.error('Could not mount the Tao Studio product host.', error)
      if (!unmounted) {
        const alert = document.createElement('p')
        alert.className = 'studio-product-host-error'
        alert.role = 'alert'
        alert.textContent = error instanceof Error ? error.message : String(error)
        root.replaceChildren(alert)
      }
    }
    const target = root.querySelector<HTMLElement>('.studio-files')
    if (target === null) {
      void mounting.catch(reportMountError)
      return () => {
        unmounted = true
        cleanup?.()
      }
    }
    setFilesTarget(target)
    void mounting.then(dispose => {
      if (unmounted) {
        dispose()
      } else {
        cleanup = dispose
      }
    }).catch(reportMountError)
    return () => {
      unmounted = true
      cleanup?.()
    }
  }, [])
  return (
    <div
      className="tao-studio-product-host"
      data-tao-studio="product-host"
      data-testid={props.Tag}
      ref={mount}
      style={props.Layout?.style}
    >
      {filesTarget === undefined ? undefined : createPortal(props.children, filesTarget)}
    </div>
  )
}

/** OpenFile is the Tao Files panel's typed request into the existing editor host. */
export async function OpenFile(path: string): Promise<void> {
  await requestStudioProductHostOpenFile(path)
}

/** File writes share the workbench controller so open drafts and tabs transition atomically. */
export async function CreateFile(path: string): Promise<void> {
  await requestStudioProductHostCreateFile(path)
}

export async function RenameFile(path: string, sourceVersion: string, targetPath: string): Promise<void> {
  await requestStudioProductHostRenameFile(path, sourceVersion, targetPath)
}

export async function DeleteFile(path: string, sourceVersion: string): Promise<void> {
  await requestStudioProductHostDeleteFile(path, sourceVersion)
}

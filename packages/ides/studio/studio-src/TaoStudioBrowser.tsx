import { Errors } from '@shared/core'
import { createRoot } from 'react-dom/client'
import TaoStudioFiles from 'tao-studio-generated-app'

const root = document.querySelector<HTMLElement>('#tao-studio-root')
if (root === null) {
  Errors.throwUnexpected('Tao Studio root is missing.')
}
root.dataset['taoStudioClient'] = 'tao'
createRoot(root).render(<TaoStudioFiles />)

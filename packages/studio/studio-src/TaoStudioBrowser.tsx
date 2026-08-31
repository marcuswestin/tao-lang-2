import { createRoot } from 'react-dom/client'
import TaoStudioFiles from 'tao-studio-generated-app'

const root = document.querySelector<HTMLElement>('#tao-studio-root')
if (root === null) {
  throw new Error('Tao Studio root is missing.')
}
root.dataset['taoStudioClient'] = 'tao'
createRoot(root).render(<TaoStudioFiles />)

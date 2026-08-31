import { mountStudio } from './client/StudioApp'

export {
  isStudioSaveShortcut,
  StudioCodeEditor,
  StudioDiagnosticNavigation,
  StudioEditorInsertion,
  type StudioOpenFileAttempt,
  StudioOpenFileLifecycle,
} from './client/StudioEditor'

if (typeof document !== 'undefined') {
  void mountStudio().catch(error => console.error('Could not mount Tao Studio.', error))
}

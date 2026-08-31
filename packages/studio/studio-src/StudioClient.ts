import { mountStudio } from './client/StudioApp'

export {
  StudioCodeEditor,
  StudioDiagnosticNavigation,
  StudioEditorInsertion,
  type StudioOpenFileAttempt,
  StudioOpenFileLifecycle,
} from './client/StudioEditor'

if (typeof document !== 'undefined') {
  void mountStudio()
}

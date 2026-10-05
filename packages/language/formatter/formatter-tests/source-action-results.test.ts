import { Describe, Test } from '@shared/test'
import { formats } from './test-format'

Describe('formatter: source action results', () => {
  Test(
    'formats canonical foreign return annotations and the Syntax2 source action body',
    formats(
      'action CreateTemporaryPDF(Book text)->TemporaryFile from ./BookIO.ts action Export(Book text){let Timer=Time.StartTimer() let File=do CreateTemporaryPDF(Book) defer DeleteTemporaryFile(File) do UploadFile(File) return Timer.Duration()}',
      `
      action CreateTemporaryPDF(Book text) -> TemporaryFile from ./BookIO.ts

      action Export(Book text) {
         let Timer = Time.StartTimer()
         let File = do CreateTemporaryPDF(Book)
         defer DeleteTemporaryFile(File)
         do UploadFile(File)
         return Timer.Duration()
      }
    `,
    ),
  )
})

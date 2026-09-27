import { ExpoApiSource, NativeBindings } from '@native-bindings'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test } from '@shared/test'
import { runCheck } from '../cli-src/source-commands'
import { checkedProjectFile, withTaoFixture } from './test-cli-files'

Describe('native Clipboard binding CLI contracts', () => {
  Test('checks generated return, nullable image, options, callback and disposal contracts', async () => {
    const generated = await NativeBindings.generate({
      source: ExpoApiSource,
      packageName: 'expo-clipboard',
      fromDirectory: Repo.resolvePath('packages/apps/expo-host'),
      exclude: ['ClipboardPasteButton', 'isPasteButtonAvailable'],
    })
    Expect(generated.diagnostics).toEqual([])
    await withTaoFixture({
      ...checkedProjectFile,
      ...generated.files,
      'Main.tao': `
use GetStringAsync, SetStringAsync, HasStringAsync, GetUrlAsync, SetUrlAsync, HasUrlAsync,
   GetImageAsync, SetImageAsync, HasImageAsync, AddClipboardListener, RemoveClipboardListener,
   ClipboardImage, ClipboardEvent, GetImageOptions, GetImageOptionsFormat, GetStringOptions,
   SetStringOptions, StringFormat from ./Bindings.tao

action Receive(Event ClipboardEvent) { }
action Image(Value ClipboardImage?) { }
action Url(Value text?) { }
action Exercise() {
   let Text = do GetStringAsync()
   let Html = do GetStringAsync(Options: GetStringOptions { PreferredFormat: StringFormat_HTML })
   let Saved = do SetStringAsync(Text: Text, Options: SetStringOptions { InputFormat: StringFormat_PLAIN_TEXT })
   let HasText = do HasStringAsync()
   let ClipboardUrl = do GetUrlAsync()
   do Url(ClipboardUrl)
   do SetUrlAsync(Url: "https://example.com")
   let HasUrl = do HasUrlAsync()
   let Png = do GetImageAsync(Options: GetImageOptions { Format: Png })
   let Jpeg = do GetImageAsync(Options: GetImageOptions { Format: Jpeg, JpegQuality: 0 })
   do Image(Png)
   do Image(Jpeg)
   do SetImageAsync(Base64Image: "abc")
   let HasImage = do HasImageAsync()
   let Subscription = do AddClipboardListener(Listener: Receive)
   do Subscription.Remove()
   do RemoveClipboardListener(Subscription)
}
`,
    }, async root => {
      const results = await runCheck(root)
      Expect(results.flatMap(result => result.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 'error'))
        .toEqual([])
      const metadata = await FS.readText(FS.resolvePath('Bindings.tao.ts', root))
      Expect(metadata).toContain('Promise<string>')
      Expect(metadata).toContain('"Width": number; "Height": number')
      Expect(metadata).toContain('"Remove"')
    })
  })
})

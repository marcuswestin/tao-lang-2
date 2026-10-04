import { jest } from '@jest/globals'
import { ExpoApiSource, NativeBindings } from '@native-bindings'
import { Repo } from '@shared'
import { Deferred, Describe, Expect, MockModule, settle, Test } from '@shared/test'
import { act, fireEvent } from '@testing-library/react-native'
import { registerRuntimeE2ELifecycle, testCompileFiles } from './test-compile-app'

registerRuntimeE2ELifecycle()

type NativeEvent = { contentTypes: string[] }
type NativeImage = { data: string; size: { width: number; height: number } }
type NativeSubscription = { remove(): void }
let listener: ((event: NativeEvent) => void) | undefined
let removalReceiver: unknown
const remove = jest.fn(function(this: unknown) {
  removalReceiver = this
})
const subscription: NativeSubscription = { remove }
const native = {
  getStringAsync: jest.fn(async (_options?: { preferredFormat?: string }): Promise<string> => ''),
  setStringAsync: jest.fn(async (_text: string, _options?: { inputFormat?: string }): Promise<boolean> => false),
  hasStringAsync: jest.fn(async (): Promise<boolean> => false),
  getUrlAsync: jest.fn(async (): Promise<string | null> => null),
  setUrlAsync: jest.fn(async (_url: string): Promise<void> => {}),
  hasUrlAsync: jest.fn(async (): Promise<boolean> => false),
  getImageAsync: jest.fn(async (_options: { format: string; jpegQuality?: number }): Promise<NativeImage | null> =>
    null
  ),
  setImageAsync: jest.fn(async (_image: string): Promise<void> => {}),
  hasImageAsync: jest.fn(async (): Promise<boolean> => false),
  addClipboardListener: jest.fn((callback: (event: NativeEvent) => void): NativeSubscription => {
    listener = callback
    return subscription
  }),
  removeClipboardListener: jest.fn((value: NativeSubscription): void => value.remove()),
}
MockModule('expo-clipboard', () => ({
  ...native,
  ContentType: { PLAIN_TEXT: 'plain-text', HTML: 'html', IMAGE: 'image', URL: 'url' },
  StringFormat: { PLAIN_TEXT: 'plainText', HTML: 'html' },
}))

const controls = `
  view Button(Title text, Action action()) {
    render inject Title, Action \`\`\`ts
      return <RN.Pressable onPress={() => Action.invoke()}><RN.Text>{Title}</RN.Text></RN.Pressable>
    \`\`\`
  }
  view Stack() { render inject Content @@content \`\`\`ts return <RN.View>{Content}</RN.View> \`\`\` }
  view Text(Value text) { render inject Value \`\`\`ts return <RN.Text>{Value}</RN.Text> \`\`\` }
`

async function generatedFiles(): Promise<Record<string, string>> {
  const generated = await NativeBindings.generate({
    source: ExpoApiSource,
    packageName: 'expo-clipboard',
    fromDirectory: Repo.resolvePath('packages/apps/expo-host'),
    exclude: ['ClipboardPasteButton', 'isPasteButtonAvailable'],
  })
  Expect(generated.diagnostics).toEqual([])
  return generated.files
}

Describe('generated native Clipboard bindings', () => {
  Test('awaits text reads, retains empty strings and false, and maps optional enum options', async () => {
    const read = Deferred<string>()
    native.getStringAsync.mockReset().mockImplementationOnce(() => read.promise).mockResolvedValue('')
    native.setStringAsync.mockClear().mockResolvedValue(false)
    native.hasStringAsync.mockClear().mockResolvedValue(false)
    await testCompileFiles('App.tao', async () => ({
      ...await generatedFiles(),
      'App.tao': `
        use GetStringAsync, SetStringAsync, HasStringAsync, GetStringOptions, SetStringOptions, StringFormat from ./Bindings.tao
        app ClipboardText { view Main }
        view Main() {
          state Status = "before"
          state Saved = true
          state HasText = true
          action Read() { let Value = do GetStringAsync() set Status = "read:{Value}" }
          action ReadHtml() {
            let Value = do GetStringAsync(Options: GetStringOptions { PreferredFormat: StringFormat_HTML })
            let Result = do SetStringAsync(Text: Value, Options: SetStringOptions { InputFormat: StringFormat_HTML })
            let Has = do HasStringAsync()
            set Status = "empty:{Value}"
            set Saved = Result
            set HasText = Has
          }
          render Stack() {
            Button("Read", Read)
            Button("ReadHtml", ReadHtml)
            Text(Status)
            Text("saved:{Saved},has:{HasText}")
          }
        }
        ${controls}
      `,
    }), async screen => {
      let pending: Promise<unknown> | undefined
      try {
        pending = Promise.resolve(fireEvent.press(screen.getByText('Read')))
        await settle()
        Expect(native.getStringAsync.mock.calls).toEqual([[]])
        screen.getByText('before')
        await act(async () => {
          read.resolve('copied')
          await pending
        })
        screen.getByText('read:copied')
        await act(async () => {
          await fireEvent.press(screen.getByText('ReadHtml'))
        })
        screen.getByText('empty:')
        screen.getByText('saved:false,has:false')
        Expect(native.getStringAsync.mock.calls).toEqual([[], [{ preferredFormat: 'html' }]])
        Expect(native.setStringAsync.mock.calls).toEqual([['', { inputFormat: 'html' }]])
      } finally {
        read.resolve('cleanup')
        await pending
      }
    })
  })

  Test('maps nested image results, format literals and null without losing zero dimensions', async () => {
    native.getImageAsync.mockReset().mockResolvedValueOnce({
      data: 'data:image/png;base64,abc',
      size: { width: 0, height: 12 },
    })
      .mockResolvedValueOnce(null)
    native.setImageAsync.mockClear().mockResolvedValue(undefined)
    native.hasImageAsync.mockClear().mockResolvedValue(false)
    await testCompileFiles('App.tao', async () => ({
      ...await generatedFiles(),
      'App.tao': `
        use GetImageAsync, SetImageAsync, HasImageAsync, GetImageOptions, GetImageOptionsFormat, ClipboardImage from ./Bindings.tao
        type Holder is { Image ClipboardImage? }
        app ClipboardImages { view Main }
        view Main() {
          state Result is Holder = Holder { }
          state HasImage = true
          action ReadPng() {
            let Image = do GetImageAsync(Options: GetImageOptions { Format: Png })
            set Result.Image = Image
            do SetImageAsync(Base64Image: "abc")
            let Has = do HasImageAsync()
            set HasImage = Has
          }
          action ReadJpeg() { let Image = do GetImageAsync(Options: GetImageOptions { Format: Jpeg, JpegQuality: 0 }) set Result.Image = Image }
          render Stack() { Button("PNG", ReadPng) Button("JPEG", ReadJpeg) ImageOutput(Result.Image) Text("has-image:{HasImage}") }
        }
        view ImageOutput(Image ClipboardImage?) {
          render inject Image \`\`\`ts return <RN.Text>{JSON.stringify(Image)}</RN.Text> \`\`\`
        }
        ${controls}
      `,
    }), async screen => {
      await act(async () => {
        await fireEvent.press(screen.getByText('PNG'))
      })
      screen.getByText('{"Data":"data:image/png;base64,abc","Size":{"Width":0,"Height":12}}')
      screen.getByText('has-image:false')
      Expect(native.setImageAsync.mock.calls).toEqual([['abc']])
      Expect(native.hasImageAsync.mock.calls).toEqual([[]])
      await act(async () => {
        await fireEvent.press(screen.getByText('JPEG'))
      })
      screen.getByText('null')
      Expect(native.getImageAsync.mock.calls).toEqual([[{ format: 'png' }], [{ format: 'jpeg', jpegQuality: 0 }]])
    })
  })

  Test('reads absent and present URLs and forwards URL writes and availability values', async () => {
    native.getUrlAsync.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce('https://example.com/copied')
    native.setUrlAsync.mockClear().mockResolvedValue(undefined)
    native.hasUrlAsync.mockReset().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    await testCompileFiles('App.tao', async () => ({
      ...await generatedFiles(),
      'App.tao': `
        use GetUrlAsync, SetUrlAsync, HasUrlAsync from ./Bindings.tao
        type Holder is { Url text? }
        app ClipboardUrls { view Main }
        view Main() {
          state Result is Holder = Holder { }
          state HasUrl = true
          action Read() {
            let Url = do GetUrlAsync()
            let Has = do HasUrlAsync()
            set Result.Url = Url
            set HasUrl = Has
          }
          action Write() { do SetUrlAsync(Url: "https://example.com/saved") }
          render Stack() { Button("Read URL", Read) Button("Write URL", Write) UrlOutput(Result.Url) Text("has-url:{HasUrl}") }
        }
        view UrlOutput(Url text?) {
          render inject Url \`\`\`ts return <RN.Text>{Url === null ? "no-url" : Url}</RN.Text> \`\`\`
        }
        ${controls}
      `,
    }), async screen => {
      await act(async () => {
        await fireEvent.press(screen.getByText('Read URL'))
      })
      screen.getByText('no-url')
      screen.getByText('has-url:false')
      await act(async () => {
        await fireEvent.press(screen.getByText('Read URL'))
      })
      screen.getByText('https://example.com/copied')
      screen.getByText('has-url:true')
      await act(async () => {
        await fireEvent.press(screen.getByText('Write URL'))
      })
      Expect(native.getUrlAsync.mock.calls).toEqual([[], []])
      Expect(native.hasUrlAsync.mock.calls).toEqual([[], []])
      Expect(native.setUrlAsync.mock.calls).toEqual([['https://example.com/saved']])
    })
  })

  Test('delivers typed events and removes a live listener once when its mounted owner unmounts', async () => {
    remove.mockClear()
    native.addClipboardListener.mockClear()
    native.setStringAsync.mockClear()
    listener = undefined
    await testCompileFiles('App.tao', async () => ({
      ...await generatedFiles(),
      'App.tao': `
        use AddClipboardListener, SetStringAsync, ClipboardEvent from ./Bindings.tao
        app ClipboardEvents { view Main }
        view Main() {
          state Count = 0
          state Event is ClipboardEvent = ClipboardEvent { ContentTypes: [] }
          action Receive(Value ClipboardEvent) { set Event = Value set Count += 1 do SetStringAsync(Text: "event") }
          action Listen() { let Subscription = do AddClipboardListener(Listener: Receive) }
          render Stack() { Button("Listen", Listen) EventOutput(Event) Text("events:{Count}") }
        }
        view EventOutput(Event ClipboardEvent) {
          render inject Event \`\`\`ts
            return <RN.Text>{Event.ContentTypes.map(value => value.caseName).join(',')}</RN.Text>
          \`\`\`
        }
        ${controls}
      `,
    }), async screen => {
      await act(async () => {
        await fireEvent.press(screen.getByText('Listen'))
      })
      Expect(native.addClipboardListener).toHaveBeenCalledTimes(1)
      Expect(listener).toBeDefined()
      await act(async () => {
        listener!({ contentTypes: ['plain-text', 'image'] })
        await settle()
      })
      screen.getByText('ContentType_PLAIN_TEXT,IMAGE')
      screen.getByText('events:1')
      Expect(native.setStringAsync.mock.calls).toEqual([['event']])
      Expect(remove).not.toHaveBeenCalled()
      screen.unmount()
      Expect(remove).toHaveBeenCalledTimes(1)
      Expect(removalReceiver).toBe(subscription)
      await act(async () => {
        // A disposed binding must not decode payloads or touch native enums again.
        listener!({ contentTypes: ['unknown-after-unmount'] })
        await settle()
      })
      Expect(native.setStringAsync.mock.calls).toEqual([['event']])
      Expect(remove).toHaveBeenCalledTimes(1)
    })
  })

  for (const mode of ['member', 'deprecated']) {
    Test(`keeps ${mode} removal idempotent with owner cleanup and ignores late events`, async () => {
      remove.mockClear()
      native.removeClipboardListener.mockClear()
      listener = undefined
      await testCompileFiles('App.tao', async () => ({
        ...await generatedFiles(),
        'App.tao': `
        use AddClipboardListener, RemoveClipboardListener, ClipboardEvent from ./Bindings.tao
        app ClipboardRemoval { view Main }
        view Main() {
          state Count = 0
          action Receive(Event ClipboardEvent) { set Count += 1 }
          action StartAndRemove() {
            let Subscription = do AddClipboardListener(Listener: Receive)
            ${
          mode === 'member'
            ? 'do Subscription.Remove() do Subscription.Remove()'
            : 'do RemoveClipboardListener(Subscription) do RemoveClipboardListener(Subscription)'
        }
          }
          render Stack() { Button("Remove", StartAndRemove) Text("events:{Count}") }
        }
        ${controls}
      `,
      }), async screen => {
        await act(async () => {
          await fireEvent.press(screen.getByText('Remove'))
        })
        Expect(remove).toHaveBeenCalledTimes(1)
        Expect(removalReceiver).toBe(subscription)
        Expect(listener).toBeDefined()
        await act(async () => {
          listener!({ contentTypes: ['html'] })
          await settle()
        })
        screen.getByText('events:0')
        if (mode === 'deprecated') {
          Expect(native.removeClipboardListener).toHaveBeenCalledTimes(2)
        }
        screen.unmount()
        Expect(remove).toHaveBeenCalledTimes(1)
      })
    })
  }
})

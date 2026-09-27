// Generated from public native API declarations. Regenerate instead of editing.

import TR from '@tao/runtime'

import { ContentType, GetImageOptionsFormat, StringFormat } from './Bindings.tao'

const native = (): typeof import('expo-clipboard') => require('expo-clipboard')

function fromContentType(value: import('expo-clipboard').ContentType): unknown {
  if (Object.is(value, native().ContentType.PLAIN_TEXT)) {
    return ContentType.ContentType_PLAIN_TEXT.evaluate().jsValue
  }
  if (Object.is(value, native().ContentType.HTML)) {
    return ContentType.ContentType_HTML.evaluate().jsValue
  }
  if (Object.is(value, native().ContentType.IMAGE)) {
    return ContentType.IMAGE.evaluate().jsValue
  }
  if (Object.is(value, native().ContentType.URL)) {
    return ContentType.URL.evaluate().jsValue
  }
  throw new TypeError('Unknown native ContentType case.')
}

function toGetImageOptionsFormat(value: unknown): 'png' | 'jpeg' {
  if (Object.is(value, GetImageOptionsFormat.Png.evaluate().jsValue)) {
    return 'png'
  }
  if (Object.is(value, GetImageOptionsFormat.Jpeg.evaluate().jsValue)) {
    return 'jpeg'
  }
  throw new TypeError('Expected a declared GetImageOptionsFormat case.')
}

function toStringFormat(value: unknown): import('expo-clipboard').StringFormat {
  if (Object.is(value, StringFormat.StringFormat_PLAIN_TEXT.evaluate().jsValue)) {
    return native().StringFormat.PLAIN_TEXT
  }
  if (Object.is(value, StringFormat.StringFormat_HTML.evaluate().jsValue)) {
    return native().StringFormat.HTML
  }
  throw new TypeError('Expected a declared StringFormat case.')
}

type ClipboardEventValue = {
  'ContentTypes': Array<unknown>
}

type NativeClipboardEvent = {
  'contentTypes': Array<import('expo-clipboard').ContentType>
}

function fromClipboardEvent(value: NativeClipboardEvent): ClipboardEventValue {
  return {
    'ContentTypes': value['contentTypes'].map(value => fromContentType(value)),
  }
}

type ClipboardImageValue = {
  'Data': string
  'Size': ClipboardImageSizeValue
}

type NativeClipboardImage = {
  'data': string
  'size': NativeClipboardImageSize
}

function fromClipboardImage(value: NativeClipboardImage): ClipboardImageValue {
  return {
    'Data': value['data'],
    'Size': fromClipboardImageSize(value['size']),
  }
}

type ClipboardImageSizeValue = {
  'Width': number
  'Height': number
}

type NativeClipboardImageSize = {
  'width': number
  'height': number
}

function fromClipboardImageSize(value: NativeClipboardImageSize): ClipboardImageSizeValue {
  return {
    'Width': value['width'],
    'Height': value['height'],
  }
}

type EventSubscriptionValue = {
  'Remove': { invoke(): void | Promise<void> }
}

type NativeEventSubscription = {
  'remove': () => void
}

const EventSubscriptionHandles = new WeakMap<EventSubscriptionValue['Remove'], NativeEventSubscription>()
function toEventSubscription(value: EventSubscriptionValue): NativeEventSubscription {
  const handle = EventSubscriptionHandles.get(value.Remove)
  if (!handle) {
    throw new TypeError('Expected a generated EventSubscription handle.')
  }
  return handle
}

function fromEventSubscription(
  value: NativeEventSubscription,
  lifetime: ReturnType<typeof TR.NativeSubscription>,
): EventSubscriptionValue {
  lifetime.attach(() => value.remove())
  const result = { Remove: TR.Action(() => lifetime.remove()).evaluate().jsValue }
  EventSubscriptionHandles.set(result.Remove, { remove: () => lifetime.remove() })
  return result
}

type GetImageOptionsValue = {
  'Format': unknown
  'JpegQuality'?: number | null
}

type NativeGetImageOptions = {
  'format': 'png' | 'jpeg'
  'jpegQuality'?: number
}

function toGetImageOptions(value: GetImageOptionsValue): NativeGetImageOptions {
  return {
    'format': toGetImageOptionsFormat(value['Format']),
    ...(value['JpegQuality'] == null ? {} : { 'jpegQuality': value['JpegQuality'] }),
  }
}

type GetStringOptionsValue = {
  'PreferredFormat'?: unknown | null
}

type NativeGetStringOptions = {
  'preferredFormat'?: import('expo-clipboard').StringFormat
}

function toGetStringOptions(value: GetStringOptionsValue): NativeGetStringOptions {
  return {
    ...(value['PreferredFormat'] == null ? {} : { 'preferredFormat': toStringFormat(value['PreferredFormat']) }),
  }
}

type SetStringOptionsValue = {
  'InputFormat'?: unknown | null
}

type NativeSetStringOptions = {
  'inputFormat'?: import('expo-clipboard').StringFormat
}

function toSetStringOptions(value: SetStringOptionsValue): NativeSetStringOptions {
  return {
    ...(value['InputFormat'] == null ? {} : { 'inputFormat': toStringFormat(value['InputFormat']) }),
  }
}

export function AddClipboardListener(
  argument0: TR.ActionValue<[TR.Value<ClipboardEventValue>]>,
): EventSubscriptionValue {
  const lifetime = TR.NativeSubscription()
  try {
    const result = native()['addClipboardListener']((value0: NativeClipboardEvent) => {
      if (lifetime.active) {
        lifetime.invoke(argument0, TR.Value(fromClipboardEvent(value0)))
      }
    })
    return fromEventSubscription(result, lifetime)
  } catch (error) {
    lifetime.remove()
    throw error
  }
}

export async function GetImageAsync(argument0: GetImageOptionsValue): Promise<ClipboardImageValue | null> {
  const result = await native()['getImageAsync'](toGetImageOptions(argument0))
  return result === null ? null : fromClipboardImage(result)
}

export async function GetStringAsync(argument0: GetStringOptionsValue | null): Promise<string> {
  if (argument0 === null) {
    const result = await native()['getStringAsync']()
    return result
  }
  const result = await native()['getStringAsync'](argument0 === null ? undefined : toGetStringOptions(argument0))
  return result
}

export async function GetUrlAsync(): Promise<string | null> {
  const result = await native()['getUrlAsync']()
  return result === null ? null : result
}

export async function HasImageAsync(): Promise<boolean> {
  const result = await native()['hasImageAsync']()
  return result
}

export async function HasStringAsync(): Promise<boolean> {
  const result = await native()['hasStringAsync']()
  return result
}

export async function HasUrlAsync(): Promise<boolean> {
  const result = await native()['hasUrlAsync']()
  return result
}

export function RemoveClipboardListener(argument0: EventSubscriptionValue): void {
  return native()['removeClipboardListener'](toEventSubscription(argument0))
}

export function SetImageAsync(argument0: string): Promise<void> {
  return native()['setImageAsync'](argument0)
}

export async function SetStringAsync(argument0: string, argument1: SetStringOptionsValue | null): Promise<boolean> {
  if (argument1 === null) {
    const result = await native()['setStringAsync'](argument0)
    return result
  }
  const result = await native()['setStringAsync'](
    argument0,
    argument1 === null ? undefined : toSetStringOptions(argument1),
  )
  return result
}

export function SetUrlAsync(argument0: string): Promise<void> {
  return native()['setUrlAsync'](argument0)
}

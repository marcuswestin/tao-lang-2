/** ExpoUpdatePlatform is the platform selector sent by an expo-updates client. */
export type ExpoUpdatePlatform = 'android' | 'ios'

/** ExpoUpdateAsset follows the open Expo Updates v1 manifest asset shape. */
export type ExpoUpdateAsset = {
  contentType: string
  fileExtension?: string
  hash?: string
  key: string
  url: string
}

/** ExpoUpdateManifest is the application/expo+json representation understood by expo-updates. */
export type ExpoUpdateManifest = {
  assets: readonly ExpoUpdateAsset[]
  createdAt: string
  extra: Readonly<Record<string, unknown>>
  id: string
  launchAsset: ExpoUpdateAsset
  metadata: Readonly<Record<string, string>>
  runtimeVersion: string
}

/** TaoPublishedUpdate is the management API's immutable publication record. */
export type TaoPublishedUpdate = {
  applicationId: string
  channel: string
  dataSchemaFingerprint: string
  manifest: ExpoUpdateManifest
  message?: string
  sourceUpdateId?: string
}

/** TaoUpdateHistory is newest-first publication history for one application channel. */
export type TaoUpdateHistory = {
  updates: readonly TaoPublishedUpdate[]
}

/** TaoUpdatePublicationData is the POST /updates data envelope emitted by TaoUpdateClient. */
export type TaoUpdatePublicationData = {
  assets: readonly ExpoUpdateAsset[]
  dataSchemaFingerprint: string
  extra: Readonly<Record<string, unknown>>
  launchAsset: ExpoUpdateAsset
  message?: string
  metadata: Readonly<Record<string, string>>
  runtimeVersion: string
  sourceUpdateId?: string
}

/** StoredUpdate carries server selection metadata that is deliberately absent from the wire response. */
export type StoredUpdate = {
  platform: ExpoUpdatePlatform
  publication: TaoPublishedUpdate
}

/** StoredAsset is immutable content addressed by its base64url SHA-256 hash. */
export type StoredAsset = {
  bytes: Uint8Array
  contentType: string
  fileExtension?: string
  hash: string
  key: string
  url: string
}

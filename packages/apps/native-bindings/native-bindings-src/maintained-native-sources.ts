import type { NativeApiImport } from './native-api'

export type MaintainedNativeSource = {
  capability: 'photos' | 'files'
  packageName: string
  version: string
  globalExports?: readonly string[]
  defer: readonly (NonNullable<NativeApiImport['defer']>[number] & { declaration: string })[]
}

const legacyReason =
  'Pinned root legacy warning exports are deprecated runtime stubs; use the modern public API or the separate legacy package entry.'

/** Approved package pins and declaration-backed inventory deferrals; generation belongs to the shared pipeline. */
export const maintainedNativeSources: readonly MaintainedNativeSource[] = [
  {
    capability: 'files',
    packageName: 'expo-file-system',
    version: '57.0.7',
    globalExports: ['AbortController'],
    defer: [
      'getInfoAsync',
      'readAsStringAsync',
      'getContentUriAsync',
      'writeAsStringAsync',
      'deleteAsync',
      'deleteLegacyDocumentDirectoryAndroid',
      'moveAsync',
      'copyAsync',
      'makeDirectoryAsync',
      'readDirectoryAsync',
      'getFreeDiskStorageAsync',
      'getTotalDiskCapacityAsync',
      'downloadAsync',
      'uploadAsync',
      'createDownloadResumable',
      'createUploadTask',
    ].map(symbol => ({
      symbol,
      disposition: 'deprecated' as const,
      declaration: 'build/legacyWarnings.d.ts',
      reason: legacyReason,
    })),
  },
  {
    capability: 'photos',
    packageName: 'expo-media-library',
    version: '57.0.5',
    defer: [
      ...[
        'isAvailableAsync',
        'presentPermissionsPickerAsync',
        'createAssetAsync',
        'saveToLibraryAsync',
        'addAssetsToAlbumAsync',
        'removeAssetsFromAlbumAsync',
        'deleteAssetsAsync',
        'getAssetInfoAsync',
        'getAlbumsAsync',
        'getAlbumAsync',
        'createAlbumAsync',
        'deleteAlbumsAsync',
        'getAssetsAsync',
        'removeSubscription',
        'getMomentsAsync',
        'migrateAlbumIfNeededAsync',
        'albumNeedsMigrationAsync',
        'setAssetFavoriteAsync',
        'getAssetContentUriAsync',
      ]
        .map(symbol => ({
          symbol,
          disposition: 'deprecated' as const,
          declaration: 'build/legacyWarnings.d.ts',
          reason: legacyReason,
        })),
      {
        symbol: 'usePermissions',
        disposition: 'react-hook',
        declaration: 'build/index.d.ts',
        reason:
          'React permission hooks require React hook execution; ordinary generated actions use requestPermissionsAsync and getPermissionsAsync.',
      },
    ],
  },
]

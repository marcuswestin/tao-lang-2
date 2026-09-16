import { HostEnvironmentError } from './TR-errors'

type NativeModules = {
  required<T>(capability: string, moduleName: 'react-native'): T
}

type ReactNativeLinkingModule = {
  Linking?: {
    openURL(url: string): Promise<any>
  }
}

/**
 * openUrl opens a URL with React Native's platform-neutral URL service.
 * In test environments (process.env.NODE_ENV === 'test'), external URL navigation is bypassed.
 */
export async function openUrl(url: string, native: NativeModules): Promise<void> {
  if (url.length === 0) {
    return
  }
  if (process.env.NODE_ENV !== 'test') {
    const module = native.required<ReactNativeLinkingModule>('Linking', 'react-native')
    const linking = module.Linking
    if (!linking) {
      throw new HostEnvironmentError(
        'Tao Linking is unavailable because native module "react-native" does not expose Linking.',
      )
    }
    await linking.openURL(url)
  }
}

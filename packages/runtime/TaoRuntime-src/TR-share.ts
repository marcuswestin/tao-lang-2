import { type TaoActionFactory, type TaoActionValue, type TaoEvaluable } from './TR-action-values'

type NativeModules = {
  required<T>(capability: string, moduleName: 'react-native'): T
}

type ReactNativeShare = {
  share(content: { message: string }): Promise<unknown>
}

type ReactNativeShareModule = {
  Share?: ReactNativeShare
}

/** TaoShareSheet is the action value returned by `@tao/device/share`'s `Share()`. */
export type TaoShareSheet = {
  readonly Open: TaoActionValue<[TaoEvaluable<string>]>
}

/**
 * createShareSheet builds the system-share value without loading React Native until Open runs.
 * Native resolution details remain intentionally unobservable until Tao ships `when do` outcomes.
 */
export function createShareSheet(
  asAction: TaoActionFactory,
  native: NativeModules,
): TaoShareSheet {
  return {
    Open: asAction(async message => {
      const module = native.required<ReactNativeShareModule>('Share', 'react-native')
      const share = module.Share
      if (!share) {
        throw new Error('Tao Share is unavailable because native module "react-native" does not expose Share.')
      }
      await share.share({ message: message.evaluate().jsValue })
    }),
  }
}

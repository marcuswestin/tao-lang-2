import { Switch } from '@shared/core'
import React from 'react'
import { Dev, DevControls, type TaoDevModeOptions } from './dev-runtime/TR-dev'
import { AccessibilityControls, type TaoAccessibilityProps } from './TR-accessibility'
import { AccessibilityInfo, type TaoAccessibilityPreferences } from './TR-accessibility-info'
import {
  ActionSheetIOS,
  type TaoActionSheetIOSAction,
  type TaoActionSheetIOSChosenAction,
  type TaoActionSheetIOSOptions,
  type TaoActionSheetIOSSelection,
  type TaoShareActionSheetIOSOptions,
  type TaoShareActionSheetIOSResult,
} from './TR-action-sheet-ios'
import { Alert, type TaoAlertAction, type TaoAlertConfirmAction } from './TR-alert'
import {
  Animated,
  type TaoAnimatedAction,
  type TaoAnimatedComposite,
  type TaoAnimatedFinishedAction,
  type TaoAnimatedValue,
} from './TR-animated'
import { AppShell } from './TR-app-shell'
import { AppState, type TaoAppStateStatus } from './TR-app-state'
import { Appearance, type TaoColorScheme } from './TR-appearance'
import {
  Async,
  type TaoAsyncAction,
  type TaoAsyncErrorAction,
  type TaoAsyncFinallyAction,
  type TaoAsyncSuccessAction,
} from './TR-async'
import {
  BackHandler,
  type TaoBackHandlerAction,
  type TaoBackHandlerExitedAction,
  type TaoBackPressAction,
} from './TR-back-handler'
import { Boundary } from './TR-boundary'
import { Clipboard, type TaoClipboardAction, type TaoClipboardCopiedAction } from './TR-clipboard'
import { Device, type TaoViewport } from './TR-device'
import { Easing, type TaoEasingFunction } from './TR-easing'
import { Feedback, type TaoFeedbackAction, type TaoFeedbackCompleteAction } from './TR-feedback'
import {
  Form,
  type TaoForm,
  type TaoSubmitAction,
  type TaoSubmitValidAction,
  type TaoTextField,
  type TaoTextInputAction,
} from './TR-form'
import { I18n, type TaoI18nInfo, type TaoTextDirection } from './TR-i18n'
import { Image, type TaoImageResizeMode, type TaoImageSource } from './TR-image'
import { Indicator, type TaoIndicatorSize, type TaoLabeledSpinnerProps } from './TR-indicator'
import { InputAccessory, type TaoInputAccessoryProps } from './TR-input-accessory-view'
import {
  InteractionManager,
  type TaoInteractionAction,
  type TaoInteractionTask,
  type TaoInteractionWorkAction,
} from './TR-interaction-manager'
import { Keyboard, type TaoKeyboardAction, type TaoKeyboardDismissedAction } from './TR-keyboard'
import { LayoutControls } from './TR-layout'
import {
  LayoutAnimation,
  type TaoLayoutAnimationAction,
  type TaoLayoutAnimationCompleteAction,
  type TaoLayoutAnimationConfig,
  type TaoLayoutAnimationPreset,
  type TaoLayoutAnimationProperty,
  type TaoLayoutAnimationType,
} from './TR-layout-animation'
import { Linking, type TaoOpenURLAction, type TaoOpenURLOpenedAction } from './TR-linking'
import { Location, type TaoLocatedAction, type TaoLocationAction, type TaoLocationResult } from './TR-location'
import {
  Media,
  type TaoImagePickedAction,
  type TaoImagePickResult,
  type TaoMediaAction,
  type TaoPickedImage,
} from './TR-media'
import { Modal, type TaoModalAction, type TaoModalAnimation, type TaoModalPresentation } from './TR-modal'
import {
  NativeColor,
  type TaoDynamicIOSColors,
  type TaoNativeColorValue,
  type TaoProcessedColor,
} from './TR-native-color'
import {
  NativeList,
  type TaoNativeListProps,
  type TaoNativeSection,
  type TaoNativeSectionListProps,
} from './TR-native-list'
import { Navigation, type TaoNavigationRef } from './TR-navigation'
import { Network, type TaoNetworkStatus } from './TR-network'
import {
  PanResponder,
  type TaoPanResponderCallbacks,
  type TaoPanResponderHandlers,
  type TaoPanResponderInstance,
  type TaoPanResponderShouldSet,
} from './TR-pan-responder'
import {
  PermissionsAndroid,
  type TaoAndroidPermission,
  type TaoAndroidPermissionRequestedAction,
  type TaoAndroidPermissionsAction,
  type TaoAndroidPermissionStatus,
} from './TR-permissions-android'
import { PixelRatio } from './TR-pixel-ratio'
import { Platform, type TaoPlatformInfo, type TaoPlatformOS } from './TR-platform'
import { RefreshControl, type TaoRefreshAction } from './TR-refresh-control'
import {
  Resource,
  type TaoResourceMutation,
  type TaoResourceMutationAction,
  type TaoResourceQuery,
} from './TR-resource'
import { SafeArea, type TaoSafeAreaInsets, type TaoSafeAreaPadding } from './TR-safe-area'
import { SecureStore, type TaoSecureStoreAction, type TaoSecureStoreCompleteAction } from './TR-secure-store'
import {
  Share,
  type TaoShareAction,
  type TaoShareContent,
  type TaoShareResult,
  type TaoShareResultAction,
} from './TR-share'
import { StatusBar, type TaoStatusBarStyle } from './TR-status-bar'
import {
  Storage,
  type TaoTextStorageAction,
  type TaoTextStorageInputAction,
  type TaoTextStorageState,
} from './TR-storage'
import { StyleControls } from './TR-style'
import { StyleSheet, type TaoStyleInput, type TaoStyleObject } from './TR-style-sheet'
import { Surface, type TaoSurfaceAction } from './TR-surface'
import * as TRTaoProps from './TR-TaoProps'
import {
  type TaoToastAndroidAction,
  type TaoToastAndroidDuration,
  type TaoToastAndroidGravity,
  type TaoToastAndroidShownAction,
  ToastAndroid,
} from './TR-toast-android'
import { type TaoLabeledToggleProps, type TaoToggleAction, Toggle } from './TR-toggle'
import {
  type TaoVibrationAction,
  type TaoVibrationCompleteAction,
  type TaoVibrationPattern,
  Vibration,
} from './TR-vibration'
import * as TRViews from './TR-views'
import type { TaoTextInputBlurAction, TaoTextInputChangeAction } from './TR-views'

/** TR exposes the generated-code runtime API used by generated apps. */
class TR {
  private constructor() {}

  /** Value creates runtime Tao values from JavaScript values. */
  static Value<T>(jsValue: T): TR.Value<T> {
    return new RuntimeValue(jsValue)
  }

  /** Action creates runtime Tao actions from generated callbacks. */
  static Action(body: (...args: any[]) => void): TR.Action {
    return new RuntimeAction(body)
  }

  /** NoopAction creates an invokable action value that intentionally does nothing. */
  static NoopAction(): TR.ActionValue {
    return new RuntimeActionValue(() => undefined)
  }

  /** Noop returns a callback that intentionally does nothing. */
  static Noop(): () => void {
    return noop
  }

  /** Alias creates live runtime Tao aliases that intentionally re-evaluate their initializer on every read. */
  static Alias<T>(value: TR.Evaluable | (() => TR.Evaluable)): TR.Alias<T> {
    return new RuntimeAlias(value)
  }

  /** BlockScope creates a child scope that can shadow parent declarations. */
  static BlockScope<ScopeT extends TR.Scope, ReturnT>(parentScope: ScopeT, body: (scope: ScopeT) => ReturnT): ReturnT {
    const scope = Object.create(parentScope) as ScopeT
    return body(scope)
  }

  /** CompoundSet returns the numeric value produced by a Tao compound state update. */
  static CompoundSet(
    state: TR.State<number>,
    operator: TR.CompoundSetOperator,
    value: TR.Value<number>,
  ): TR.Value<number> {
    const current = state.evaluate().jsValue
    const next = value.evaluate().jsValue
    return Switch(operator, {
      '+=': () => new RuntimeValue(current + next),
      '-=': () => new RuntimeValue(current - next),
      '*=': () => new RuntimeValue(current * next),
      '/=': () => new RuntimeValue(current / next),
    })
  }

  /** Do invokes a Tao action value with already-compiled runtime arguments. */
  static Do(action: TR.Action, ...args: any[]): void {
    action.evaluate().jsValue.invoke(...args)
  }

  /** Set updates a Tao state value. */
  static Set<T>(state: TR.State<T>, value: () => TR.Value<T>): void {
    state.set(value())
  }

  /** State creates view-local reactive Tao state. */
  static State<T>(initialValue: () => TR.Value<T>): TR.State<T> {
    const [jsValue, setJsValue] = React.useState<T>(() => initialValue().evaluate().jsValue)
    const jsValueRef = React.useRef(jsValue)
    jsValueRef.current = jsValue
    return new RuntimeState(jsValueRef, setJsValue)
  }

  /** Use binds an imported module declaration into a file scope as a lazy, live binding. */
  static Use(scope: TR.Scope, name: string, getValue: () => unknown): void {
    Object.defineProperty(scope, name, {
      // Lazy reads keep circular module imports working: the imported binding is only
      // dereferenced when used, after module initialization.
      get: getValue,
      // Assignments through child scopes must still shadow on the receiver instead of
      // throwing against a get-only prototype property.
      set(value: unknown) {
        Object.defineProperty(this, name, { value, writable: true, enumerable: true, configurable: true })
      },
      enumerable: true,
      configurable: true,
    })
  }

  /** TaoProps creates a Tao-owned props bag with optional inherited caller props. */
  static TaoProps(localProps: TR.TaoProps, callerProps?: TR.TaoProps): TR.TaoProps {
    if (!callerProps) {
      return localProps
    }

    const inheritedParentDirection = parentDirectionFromProps(callerProps)
    return inheritedParentDirection && localProps.parentDirection === undefined
      ? { ...localProps, parentDirection: inheritedParentDirection, callerProps }
      : { ...localProps, callerProps }
  }

  /** setDevMode configures Tao runtime development-only diagnostics. */
  static setDevMode(options?: TR.DevModeOptions): void {
    Dev.setMode(options)
  }

  /** AppShell wraps generated app roots in Tao's safe default app frame. */
  static readonly AppShell = AppShell

  /** ActionSheetIOS exposes React Native iOS action-sheet helpers. */
  static readonly ActionSheetIOS = ActionSheetIOS

  /** Accessibility exposes generated-code native accessibility metadata helpers. */
  static readonly Accessibility = AccessibilityControls

  /** AccessibilityInfo exposes native accessibility preference helpers. */
  static readonly AccessibilityInfo = AccessibilityInfo

  /** Alert exposes native alert helpers for generated Tao apps. */
  static readonly Alert = Alert

  /** Animated exposes React Native animation helpers for generated Tao apps. */
  static readonly Animated = Animated

  /** Appearance exposes native visual preference helpers for generated Tao apps. */
  static readonly Appearance = Appearance

  /** AppState exposes native foreground/background state helpers for generated Tao apps. */
  static readonly AppState = AppState

  /** Async exposes helpers for bridge actions that complete asynchronously. */
  static readonly Async = Async

  /** BackHandler exposes native hardware-back helpers for generated Tao apps. */
  static readonly BackHandler = BackHandler

  /** Boundary exposes app-visible loading and error containment helpers. */
  static readonly Boundary = Boundary

  /** Clipboard exposes native text clipboard helpers for generated Tao apps. */
  static readonly Clipboard = Clipboard

  /** Dev exposes public Tao runtime development-only diagnostic controls. */
  static readonly Dev = DevControls

  /** Device exposes React Native device and viewport helpers. */
  static readonly Device = Device

  /** Easing exposes React Native animation easing helpers for generated Tao apps. */
  static readonly Easing = Easing

  /** Feedback exposes native tactile feedback helpers for generated Tao apps. */
  static readonly Feedback = Feedback

  /** Form exposes React Hook Form-backed helpers for generated Tao app forms. */
  static readonly Form = Form

  /** Image exposes React Native image source helpers for generated Tao apps. */
  static readonly Image = Image

  /** I18n exposes React Native internationalization layout-direction helpers. */
  static readonly I18n = I18n

  /** Indicator exposes React Native progress indicator helpers for generated Tao apps. */
  static readonly Indicator = Indicator

  /** InputAccessory exposes React Native iOS input accessory helpers for generated Tao apps. */
  static readonly InputAccessory = InputAccessory

  /** InteractionManager exposes React Native post-interaction scheduling helpers. */
  static readonly InteractionManager = InteractionManager

  /** Keyboard exposes native keyboard helpers for generated Tao apps. */
  static readonly Keyboard = Keyboard

  /** LayoutAnimation exposes React Native layout transition helpers for generated Tao apps. */
  static readonly LayoutAnimation = LayoutAnimation

  /** Layout exposes deterministic runtime lowering for Tao layout clauses. */
  static readonly Layout = LayoutControls

  /** Linking exposes native external URL helpers for generated Tao apps. */
  static readonly Linking = Linking

  /** Location exposes native foreground location helpers for generated Tao apps. */
  static readonly Location = Location

  /** Media exposes native media picker helpers for generated Tao apps. */
  static readonly Media = Media

  /** Modal exposes React Native modal overlay helpers for generated Tao apps. */
  static readonly Modal = Modal

  /** Navigation exposes React Navigation-backed routing helpers for generated Tao apps. */
  static readonly Navigation = Navigation

  /** NativeColor exposes React Native platform-native color helpers for generated Tao apps. */
  static readonly NativeColor = NativeColor

  /** NativeList exposes React Native virtualized list helpers for generated Tao apps. */
  static readonly NativeList = NativeList

  /** Network exposes React Native reachability helpers for generated Tao apps. */
  static readonly Network = Network

  /** PermissionsAndroid exposes React Native Android runtime permission helpers. */
  static readonly PermissionsAndroid = PermissionsAndroid

  /** PanResponder exposes React Native gesture responder creation helpers. */
  static readonly PanResponder = PanResponder

  /** PixelRatio exposes React Native pixel-density helpers for generated Tao apps. */
  static readonly PixelRatio = PixelRatio

  /** Platform exposes React Native platform helpers for generated Tao apps. */
  static readonly Platform = Platform

  /** RefreshControl exposes React Native pull-to-refresh helpers for generated Tao apps. */
  static readonly RefreshControl = RefreshControl

  /** Resource exposes async app-data helpers for generated Tao apps. */
  static readonly Resource = Resource

  /** SafeArea exposes provider-backed native safe-area helpers for generated Tao apps. */
  static readonly SafeArea = SafeArea

  /** SecureStore exposes native secret persistence helpers for generated Tao apps. */
  static readonly SecureStore = SecureStore

  /** Share exposes native share-sheet helpers for generated Tao apps. */
  static readonly Share = Share

  /** StatusBar exposes React Native status-bar helpers for generated Tao apps. */
  static readonly StatusBar = StatusBar

  /** StyleSheet exposes React Native style-sheet helpers for generated Tao apps. */
  static readonly StyleSheet = StyleSheet

  /** Storage exposes local persistence helpers for generated Tao apps. */
  static readonly Storage = Storage

  /** Style exposes deterministic Tao visual defaults. */
  static readonly Style = StyleControls

  /** Surface exposes default loading, empty, and error-state UI helpers. */
  static readonly Surface = Surface

  /** Toggle exposes React Native Switch helpers for generated Tao apps. */
  static readonly Toggle = Toggle

  /** ToastAndroid exposes React Native Android toast helpers for generated Tao apps. */
  static readonly ToastAndroid = ToastAndroid

  /** Vibration exposes React Native vibration helpers for generated Tao apps. */
  static readonly Vibration = Vibration

  /** Views exposes runtime-backed Tao stdlib primitives. */
  static readonly Views = TRViews.Views
}

function parentDirectionFromProps(props: TR.TaoProps | undefined): TR.TaoProps['parentDirection'] {
  if (!props) {
    return undefined
  }
  return props.parentDirection ?? parentDirectionFromProps(props.callerProps)
}

function noop(): void {}

class RuntimeValue<T> {
  constructor(readonly jsValue: T) {}

  evaluate(): RuntimeValue<T> {
    return this
  }
}

class RuntimeAlias<T> {
  constructor(private readonly value: TR.Evaluable | (() => TR.Evaluable)) {}

  evaluate(): TR.AliasValue<T> {
    return (typeof this.value === 'function' ? this.value() : this.value).evaluate() as TR.AliasValue<T>
  }
}

class RuntimeState<T> {
  constructor(
    private readonly jsValueRef: { current: T },
    private readonly setJsValue: React.Dispatch<React.SetStateAction<T>>,
  ) {}

  evaluate(): RuntimeValue<T> {
    return new RuntimeValue(this.jsValueRef.current)
  }

  set(value: TR.Value<T>): void {
    const nextValue = value.evaluate().jsValue
    this.jsValueRef.current = nextValue
    this.setJsValue(nextValue)
  }
}

class RuntimeActionValue {
  constructor(private readonly body: (...args: any[]) => void) {}

  invoke(...args: any[]): void {
    this.body(...args)
  }
}

class RuntimeAction {
  readonly jsValue: RuntimeActionValue

  constructor(body: (...args: any[]) => void) {
    this.jsValue = new RuntimeActionValue(body)
  }

  evaluate(): RuntimeAction {
    return this
  }
}

namespace TR {
  /** Action declares a runtime Tao action wrapper. */
  export type Action = RuntimeAction
  /** ActionSheetIOSAction declares a Pressable-compatible iOS action-sheet action. */
  export type ActionSheetIOSAction = TaoActionSheetIOSAction
  /** ActionSheetIOSChosenAction declares an iOS action-sheet selection callback bridge action. */
  export type ActionSheetIOSChosenAction = TaoActionSheetIOSChosenAction
  /** ActionSheetIOSOptions declares iOS action-sheet display options. */
  export type ActionSheetIOSOptions = TaoActionSheetIOSOptions
  /** ActionSheetIOSSelection declares an iOS action-sheet selected button. */
  export type ActionSheetIOSSelection = TaoActionSheetIOSSelection
  /** ActionValue declares the JavaScript payload for an evaluated Tao action. */
  export type ActionValue = RuntimeActionValue
  /** Accessibility declares native accessibility metadata for rendered Tao views. */
  export type Accessibility = TaoAccessibilityProps
  /** AccessibilityPreferences declares native accessibility preference state. */
  export type AccessibilityPreferences = TaoAccessibilityPreferences
  /** Alias declares a runtime Tao alias wrapper. */
  export type Alias<T> = RuntimeAlias<T>
  /** AliasValue declares the evaluated runtime value for a Tao alias. */
  export type AliasValue<T> = T extends TR.Action ? TR.Action : TR.Value<T>
  /** AlertAction declares a Pressable-compatible native alert action. */
  export type AlertAction = TaoAlertAction
  /** AlertConfirmAction declares an alert-confirmation callback bridge action. */
  export type AlertConfirmAction = TaoAlertConfirmAction
  /** AnimatedAction declares a Pressable-compatible animation action. */
  export type AnimatedAction = TaoAnimatedAction
  /** AnimatedComposite declares a React Native composite animation. */
  export type AnimatedComposite = TaoAnimatedComposite
  /** AnimatedFinishedAction declares an animation completion callback bridge action. */
  export type AnimatedFinishedAction = TaoAnimatedFinishedAction
  /** AnimatedValue declares a React Native animated value. */
  export type AnimatedValue = TaoAnimatedValue
  /** AppStateStatus declares normalized native app lifecycle state. */
  export type AppStateStatus = TaoAppStateStatus
  /** AsyncAction declares a Pressable-compatible async action with pending and error state. */
  export type AsyncAction<Result = unknown> = TaoAsyncAction<Result>
  /** AsyncErrorAction declares an async failure callback bridge action. */
  export type AsyncErrorAction = TaoAsyncErrorAction
  /** AsyncFinallyAction declares an async completion callback bridge action. */
  export type AsyncFinallyAction = TaoAsyncFinallyAction
  /** AsyncSuccessAction declares an async success callback bridge action. */
  export type AsyncSuccessAction<Result> = TaoAsyncSuccessAction<Result>
  /** BackHandlerAction declares a Pressable-compatible native app-exit action. */
  export type BackHandlerAction = TaoBackHandlerAction
  /** BackHandlerExitedAction declares a native app-exit completion callback bridge action. */
  export type BackHandlerExitedAction = TaoBackHandlerExitedAction
  /** BackPressAction declares a hardware-back callback bridge action. */
  export type BackPressAction = TaoBackPressAction
  /** CompoundSetOperator declares supported numeric compound state update operators. */
  export type CompoundSetOperator = '+=' | '-=' | '*=' | '/='
  /** ClipboardAction declares a Pressable-compatible async clipboard action. */
  export type ClipboardAction = TaoClipboardAction
  /** ClipboardCopiedAction declares a clipboard-copy result callback bridge action. */
  export type ClipboardCopiedAction = TaoClipboardCopiedAction
  /** ColorScheme declares normalized native visual preference state. */
  export type ColorScheme = TaoColorScheme
  /** Evaluable declares runtime values that can collapse to their current value. */
  export type Evaluable = { evaluate(): any }
  /** EasingFunction declares a React Native normalized animation easing function. */
  export type EasingFunction = TaoEasingFunction
  /** FeedbackAction declares a Pressable-compatible async tactile-feedback action. */
  export type FeedbackAction = TaoFeedbackAction
  /** FeedbackCompleteAction declares a tactile-feedback completion callback bridge action. */
  export type FeedbackCompleteAction = TaoFeedbackCompleteAction
  /** Viewport declares normalized React Native window dimensions. */
  export type Viewport = TaoViewport
  /** Form declares a React Hook Form-backed generated Tao form controller. */
  export type Form<T extends Record<string, any>> = TaoForm<T>
  /** KeyboardAction declares a Pressable-compatible native keyboard action. */
  export type KeyboardAction = TaoKeyboardAction
  /** KeyboardDismissedAction declares a keyboard-dismissal completion callback bridge action. */
  export type KeyboardDismissedAction = TaoKeyboardDismissedAction
  /** LayoutAnimationAction declares a Pressable-compatible layout-animation action. */
  export type LayoutAnimationAction = TaoLayoutAnimationAction
  /** LayoutAnimationCompleteAction declares a layout-animation completion callback bridge action. */
  export type LayoutAnimationCompleteAction = TaoLayoutAnimationCompleteAction
  /** LayoutAnimationConfig declares a React Native layout-animation config. */
  export type LayoutAnimationConfig = TaoLayoutAnimationConfig
  /** LayoutAnimationPreset declares supported React Native layout-animation presets. */
  export type LayoutAnimationPreset = TaoLayoutAnimationPreset
  /** LayoutAnimationProperty declares supported React Native layout-animation properties. */
  export type LayoutAnimationProperty = TaoLayoutAnimationProperty
  /** LayoutAnimationType declares supported React Native layout-animation timing types. */
  export type LayoutAnimationType = TaoLayoutAnimationType
  /** TextField declares React Native TextInput-compatible props for a form field. */
  export type TextField = TaoTextField
  /** TextInputAction declares a generated TextInput-compatible form change action. */
  export type TextInputAction = TaoTextInputAction
  /** TextInputChangeAction declares a generated TextInput-compatible change action. */
  export type TextInputChangeAction = TaoTextInputChangeAction
  /** TextInputBlurAction declares a generated TextInput-compatible form blur action. */
  export type TextInputBlurAction = TaoTextInputBlurAction
  /** SubmitAction declares an invokable React Hook Form submit bridge. */
  export type SubmitAction = TaoSubmitAction
  /** SubmitValidAction declares a valid form-submit callback bridge action. */
  export type SubmitValidAction<T extends Record<string, any>> = TaoSubmitValidAction<T>
  /** NavigationRef declares an imperative React Navigation container reference. */
  export type NavigationRef = TaoNavigationRef
  /** OpenURLAction declares a Pressable-compatible async external-link action. */
  export type OpenURLAction = TaoOpenURLAction
  /** OpenURLOpenedAction declares an external-link open result callback bridge action. */
  export type OpenURLOpenedAction = TaoOpenURLOpenedAction
  /** LocationAction declares a Pressable-compatible async foreground-location action. */
  export type LocationAction = TaoLocationAction
  /** LocatedAction declares a foreground-location result callback bridge action. */
  export type LocatedAction = TaoLocatedAction
  /** LocationResult declares a normalized foreground location result. */
  export type LocationResult = TaoLocationResult
  /** MediaAction declares a Pressable-compatible async media picker action. */
  export type MediaAction = TaoMediaAction
  /** ImagePickedAction declares an image-pick result callback bridge action. */
  export type ImagePickedAction = TaoImagePickedAction
  /** PickedImage declares a normalized image selected from the native media library. */
  export type PickedImage = TaoPickedImage
  /** ImagePickResult declares the normalized result of a native image picker run. */
  export type ImagePickResult = TaoImagePickResult
  /** ImageResizeMode declares supported React Native image resize behavior. */
  export type ImageResizeMode = TaoImageResizeMode
  /** ImageSource declares a normalized React Native image source. */
  export type ImageSource = TaoImageSource
  /** I18nInfo declares normalized native layout-direction settings. */
  export type I18nInfo = TaoI18nInfo
  /** IndicatorSize declares supported React Native activity-indicator sizes. */
  export type IndicatorSize = TaoIndicatorSize
  /** LabeledSpinnerProps declares Tao props for an accessible progress row. */
  export type LabeledSpinnerProps = TaoLabeledSpinnerProps
  /** InputAccessoryProps declares React Native InputAccessoryView props. */
  export type InputAccessoryProps = TaoInputAccessoryProps
  /** InteractionAction declares a Pressable-compatible deferred interaction action. */
  export type InteractionAction = TaoInteractionAction
  /** InteractionWorkAction declares deferred work for InteractionManager scheduling. */
  export type InteractionWorkAction = TaoInteractionWorkAction
  /** InteractionTask declares a cancellable React Native post-interaction task. */
  export type InteractionTask = TaoInteractionTask
  /** ModalAnimation declares supported React Native modal animation types. */
  export type ModalAnimation = TaoModalAnimation
  /** ModalAction declares a Modal-compatible lifecycle action. */
  export type ModalAction = TaoModalAction
  /** ModalPresentation declares supported React Native modal presentation styles. */
  export type ModalPresentation = TaoModalPresentation
  /** NetworkStatus declares a normalized React Native network reachability state. */
  export type NetworkStatus = TaoNetworkStatus
  /** DynamicIOSColors declares native iOS color variants. */
  export type DynamicIOSColors = TaoDynamicIOSColors
  /** NativeColorValue declares a React Native native color token or processed color input. */
  export type NativeColorValue = TaoNativeColorValue
  /** NativeListProps declares React Native FlatList props normalized for generated apps. */
  export type NativeListProps<ItemT> = TaoNativeListProps<ItemT>
  /** NativeSection declares a React Native SectionList section. */
  export type NativeSection<ItemT> = TaoNativeSection<ItemT>
  /** NativeSectionListProps declares React Native SectionList props normalized for generated apps. */
  export type NativeSectionListProps<ItemT> = TaoNativeSectionListProps<ItemT>
  /** ProcessedColor declares a numeric React Native processed color when available. */
  export type ProcessedColor = TaoProcessedColor
  /** AndroidPermission declares a React Native Android runtime permission name. */
  export type AndroidPermission = TaoAndroidPermission
  /** AndroidPermissionsAction declares a Pressable-compatible Android permission action. */
  export type AndroidPermissionsAction = TaoAndroidPermissionsAction
  /** AndroidPermissionRequestedAction declares an Android permission result callback bridge action. */
  export type AndroidPermissionRequestedAction = TaoAndroidPermissionRequestedAction
  /** AndroidPermissionStatus declares normalized Android permission request results. */
  export type AndroidPermissionStatus = TaoAndroidPermissionStatus
  /** PanResponderCallbacks declares React Native pan responder lifecycle callbacks. */
  export type PanResponderCallbacks = TaoPanResponderCallbacks
  /** PanResponderHandlers declares React Native pan responder view handlers. */
  export type PanResponderHandlers = TaoPanResponderHandlers
  /** PanResponderInstance declares a React Native pan responder object. */
  export type PanResponderInstance = TaoPanResponderInstance
  /** PanResponderShouldSet declares a stable React Native pan responder predicate. */
  export type PanResponderShouldSet = TaoPanResponderShouldSet
  /** PlatformInfo declares normalized React Native platform details. */
  export type PlatformInfo = TaoPlatformInfo
  /** PlatformOS declares normalized React Native OS names. */
  export type PlatformOS = TaoPlatformOS
  /** RefreshAction declares a pull-to-refresh-compatible action. */
  export type RefreshAction = TaoRefreshAction
  /** TextStorageState declares a local persisted text value. */
  export type TextStorageState = TaoTextStorageState
  /** TextStorageAction declares a Pressable-compatible local persistence action. */
  export type TextStorageAction = TaoTextStorageAction
  /** TextStorageInputAction declares a TextInput-compatible local persistence action. */
  export type TextStorageInputAction = TaoTextStorageInputAction
  /** TextDirection declares normalized native layout direction. */
  export type TextDirection = TaoTextDirection
  /** State declares a runtime Tao state wrapper. */
  export type State<T> = RuntimeState<T>
  /** Value declares a runtime Tao value wrapper. */
  export type Value<T> = RuntimeValue<T>
  /** ResourceQuery declares the evaluated state for an async Tao resource query. */
  export type ResourceQuery<T> = TaoResourceQuery<T>
  /** ResourceMutation declares mutation state for async Tao writes. */
  export type ResourceMutation<Input, Output> = TaoResourceMutation<Input, Output>
  /** ResourceMutationAction declares a Pressable-compatible mutation action. */
  export type ResourceMutationAction = TaoResourceMutationAction
  /** SafeAreaInsets declares normalized native safe-area edge insets. */
  export type SafeAreaInsets = TaoSafeAreaInsets
  /** SafeAreaPadding declares React Native padding style values derived from safe-area insets. */
  export type SafeAreaPadding = TaoSafeAreaPadding
  /** SecureStoreAction declares a Pressable-compatible async secret storage action. */
  export type SecureStoreAction = TaoSecureStoreAction
  /** SecureStoreCompleteAction declares a secret storage completion callback bridge action. */
  export type SecureStoreCompleteAction = TaoSecureStoreCompleteAction
  /** ShareAction declares a Pressable-compatible async native sharing action. */
  export type ShareAction = TaoShareAction
  /** ShareContent declares normalized native share-sheet content. */
  export type ShareContent = TaoShareContent
  /** ShareResult declares the normalized result of a native share-sheet action. */
  export type ShareResult = TaoShareResult
  /** ShareResultAction declares a native share result callback bridge action. */
  export type ShareResultAction = TaoShareResultAction
  /** ShareActionSheetIOSOptions declares iOS share action-sheet display options. */
  export type ShareActionSheetIOSOptions = TaoShareActionSheetIOSOptions
  /** ShareActionSheetIOSResult declares an iOS share action-sheet result. */
  export type ShareActionSheetIOSResult = TaoShareActionSheetIOSResult
  /** StatusBarStyle declares supported React Native status-bar styles. */
  export type StatusBarStyle = TaoStatusBarStyle
  /** StyleInput declares a React Native style input value. */
  export type StyleInput = TaoStyleInput
  /** StyleObject declares a flattened React Native style object. */
  export type StyleObject = TaoStyleObject
  /** SurfaceAction declares an app-visible action for default state surfaces. */
  export type SurfaceAction = TaoSurfaceAction
  /** ToggleAction declares a native switch-compatible value-change action. */
  export type ToggleAction = TaoToggleAction
  /** LabeledToggleProps declares Tao props for an accessible switch row. */
  export type LabeledToggleProps = TaoLabeledToggleProps
  /** ToastAndroidAction declares a Pressable-compatible Android toast action. */
  export type ToastAndroidAction = TaoToastAndroidAction
  /** ToastAndroidDuration declares supported Android toast durations. */
  export type ToastAndroidDuration = TaoToastAndroidDuration
  /** ToastAndroidGravity declares supported Android toast gravity values. */
  export type ToastAndroidGravity = TaoToastAndroidGravity
  /** ToastAndroidShownAction declares an Android toast display completion callback bridge action. */
  export type ToastAndroidShownAction = TaoToastAndroidShownAction
  /** VibrationAction declares a Pressable-compatible native vibration action. */
  export type VibrationAction = TaoVibrationAction
  /** VibrationCompleteAction declares a vibration completion callback bridge action. */
  export type VibrationCompleteAction = TaoVibrationCompleteAction
  /** VibrationPattern declares native vibration duration or pattern input. */
  export type VibrationPattern = TaoVibrationPattern
  /** Scope declares generated Tao runtime declaration storage. */
  export type Scope = Record<string, any>
  /** TaoProps declares the Tao-owned props bag generated views receive as the `__tao` prop. */
  export type TaoProps = TRTaoProps.TaoProps
  /** DevModeOptions declares runtime development-only diagnostic flags. */
  export type DevModeOptions = TaoDevModeOptions
}

export default TR

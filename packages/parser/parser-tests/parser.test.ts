import { ASTUtils, Packages, Type } from '@ast-utils'
import { AST } from '@parser'
import { FS, Repo } from '@shared'
import { Describe, Expect, Test, withTaoFiles } from '@shared/test'
import { Workspace } from '@workspace'
import { testParseCode, testParseSyntax } from './test-parse'

const kitchenSinkPath = Repo.resolvePath('Apps/Kitchen Sink/Kitchen Sink.tao')
const kitchenSinkTestPath = Repo.resolvePath('Apps/Kitchen Sink/Kitchen Sink.test.tao')
const typeSystemTestsPath = Repo.resolvePath('Apps/Test Apps/Type System Tests/Type System Tests.tao')
const runtimeStdlibTestsPath = Repo.resolvePath('Apps/Test Apps/Runtime Stdlib Tests/Runtime Stdlib Tests.tao')

Describe('minimal Tao parser', () => {
  Test('parses the current Kitchen Sink app', async () => {
    const parseResult = await Workspace.parse(kitchenSinkPath)

    Expect(parseResult.diagnostics).toEqual([])

    const useStatement = parseResult.entry.ast.statements.find(AST.isUseStatement)
    const app = parseResult.entry.ast.statements.find(AST.isAppDeclaration)
    const greetingAlias = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'Greeting',
    )
    const launchCountAlias = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'LaunchCount',
    )
    const mainView = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'MainView',
    )
    const countTextView = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'CountText',
    )
    Expect.Is(useStatement, AST.isUseStatement)
    Expect.Is(app, AST.isAppDeclaration)
    Expect.Is(greetingAlias, AST.isAliasDeclaration)
    Expect.Is(launchCountAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isViewDeclaration)
    Expect.Is(countTextView, AST.isViewDeclaration)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual([
      'AccessibilityPreferencesText',
      'ActionSheetButton',
      'AlertButton',
      'AndroidPermissionText',
      'AnimatedText',
      'AppExitButton',
      'AppStateText',
      'AppearanceText',
      'AsyncActionStatusText',
      'BoundaryLoading',
      'Button',
      'ConfirmButton',
      'CopyButton',
      'DeferredButton',
      'DisabledButton',
      'DisabledToggleSwitch',
      'EasingText',
      'EmailInput',
      'EmptyState',
      'ErrorState',
      'FeedbackButton',
      'FormRoot',
      'I18nText',
      'Image',
      'ImageStatusText',
      'InputAccessoryBar',
      'InputAccessoryText',
      'KeyboardAvoidingStack',
      'KeyboardDismissButton',
      'LargeSpinner',
      'LayoutAnimationButton',
      'LinkButton',
      'LoadingButton',
      'LoadingState',
      'LocationButton',
      'MediaPickerButton',
      'ModalOptionsText',
      'ModalSheet',
      'NativeColorText',
      'NativeList',
      'NavigationRoot',
      'NetworkText',
      'Number',
      'NumericInput',
      'OneTimeCodeInput',
      'PanResponderText',
      'PasswordInput',
      'PhoneInput',
      'PixelRatioText',
      'PlatformText',
      'RefreshStack',
      'RefreshingText',
      'ResourceMutationButton',
      'ResourceText',
      'SafeAreaPaddingText',
      'SafeAreaStack',
      'Screen',
      'ScrollStack',
      'SearchInput',
      'SectionList',
      'SecureDeleteButton',
      'SecureSaveButton',
      'ShareButton',
      'Spinner',
      'Stack',
      'StatusBar',
      'StorageSaveButton',
      'StorageText',
      'StyleSheetText',
      'Text',
      'TextArea',
      'TextInput',
      'ThemedStack',
      'ToastButton',
      'ToggleSwitch',
      'ToggleValueText',
      'URLInput',
      'VibrationButton',
      'ViewportText',
    ])
    Expect(useStatement.importPath).toBe('@tao/ui')

    Expect(app.name).toBe('KitchenSink')
    const appRoot = AST.blockStatementOf(app, 0)
    Expect.Is(appRoot, AST.isAppView)
    Expect(appRoot.view.ref?.name).toBe('MainView')

    Expect(greetingAlias.name).toBe('Greeting')
    Expect.Is(greetingAlias.value, AST.isStringLiteral)
    Expect(launchCountAlias.name).toBe('LaunchCount')
    Expect.Is(launchCountAlias.value, AST.isNumberLiteral)

    Expect(mainView.name).toBe('MainView')
    const [
      kitchenCountState,
      kitchenNameState,
      localTextAlias,
      outerGreetingAlias,
      renameAction,
      addCountAction,
      mainRender,
    ] = mainView.block.statements
    Expect.Is(kitchenCountState, AST.isStateDeclaration)
    Expect.Is(kitchenNameState, AST.isStateDeclaration)
    Expect.Is(localTextAlias, AST.isAliasDeclaration)
    Expect.Is(outerGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(renameAction, AST.isActionDeclaration)
    Expect.Is(addCountAction, AST.isActionDeclaration)
    Expect.Is(mainRender, AST.isRenderStatement)
    Expect(mainRender.view?.ref?.name).toBe('Stack')
    Expect(kitchenCountState.name).toBe('KitchenCount')
    Expect(kitchenNameState.name).toBe('KitchenName')
    Expect.Is(kitchenCountState.value, AST.isNumberLiteral)
    Expect.Is(kitchenNameState.value, AST.isStringLiteral)
    Expect(localTextAlias.name).toBe('LocalText')
    Expect(outerGreetingAlias.name).toBe('OuterGreeting')
    Expect(renameAction.name).toBe('RenameKitchenName')
    Expect(addCountAction.name).toBe('AddKitchenCount')
    Expect.Is(outerGreetingAlias.value, AST.isValueReference)
    Expect(valueDeclarationName(outerGreetingAlias.value.target.ref)).toBe('Greeting')

    const [blockGreetingAlias] = AST.statementsOf(mainRender.block)
    Expect.Is(blockGreetingAlias, AST.isAliasDeclaration)
    Expect(blockGreetingAlias.name).toBe('Greeting')
    const childInvocations = AST.statementsOf(mainRender.block).filter(AST.isViewRender)
    Expect(childInvocations).toHaveLength(131)
    const [
      outerText,
      shadowedText,
      nestedText,
      literalText,
      claimedText,
      countText,
      fixedNameText,
      profileNameText,
      tagText,
      kitchenImage,
      imageStatusText,
      indicatorStatusText,
      resourceStatusText,
      resourceMutationStatusText,
      kitchenResourceText,
      kitchenResourceMutationButton,
      kitchenStorageText,
      kitchenStorageSaveButton,
      networkStatusText,
      kitchenNetworkText,
      nativeColorStatusText,
      kitchenNativeColorText,
      nativeListStatusText,
      kitchenNativeList,
      kitchenSectionList,
      refreshStack,
      scrollStack,
      keyboardAvoidingStack,
      safeAreaStack,
      screen,
      modalSheet,
      permissionsAndroidStatusText,
      kitchenAndroidPermissionText,
      animatedStatusText,
      kitchenAnimatedText,
      deviceStatusText,
      kitchenViewportText,
      easingStatusText,
      kitchenEasingText,
      pixelRatioStatusText,
      kitchenPixelRatioText,
      panResponderStatusText,
      kitchenPanResponderText,
      platformStatusText,
      kitchenPlatformText,
      i18nStatusText,
      kitchenI18nText,
      inputAccessoryStatusText,
      kitchenInputAccessoryText,
      safeAreaStatusText,
      kitchenSafeAreaPaddingText,
      statusBarStatusText,
      kitchenStatusBar,
      styleSheetStatusText,
      kitchenStyleSheetText,
      modalStatusText,
      kitchenModalOptionsText,
      refreshControlStatusText,
      kitchenRefreshingText,
      toggleStatusText,
      kitchenToggleValueText,
      boundaryStatusText,
      boundaryLoading,
      navigationRoot,
      surfaceStatusText,
      themedStatusText,
      themedStack,
      formRoot,
      formValidationStatusText,
      asyncActionStatusText,
      pressableStateStatusText,
      clipboardStatusText,
      linkingStatusText,
      feedbackStatusText,
      mediaStatusText,
      secureStoreStatusText,
      locationStatusText,
      shareStatusText,
      actionSheetIOSStatusText,
      alertStatusText,
      keyboardStatusText,
      toastAndroidStatusText,
      vibrationStatusText,
      interactionManagerStatusText,
      layoutAnimationStatusText,
      appStateStatusText,
      kitchenAppStateText,
      appearanceStatusText,
      kitchenAppearanceText,
      accessibilityInfoStatusText,
      kitchenAccessibilityPreferencesText,
      backHandlerStatusText,
      kitchenTextInput,
      kitchenNotesInput,
      kitchenPasswordInput,
      kitchenEmailInput,
      kitchenSearchInput,
      kitchenPhoneInput,
      kitchenURLInput,
      kitchenNumericInput,
      kitchenCodeInput,
      kitchenNameText,
      kitchenNumber,
      kitchenButton,
      kitchenDisabledButton,
      kitchenLoadingButton,
      kitchenSpinner,
      kitchenLargeSpinner,
      kitchenEmptyState,
      kitchenLoadingState,
      kitchenErrorState,
      kitchenInputAccessoryBar,
      kitchenToggleSwitch,
      kitchenDisabledToggleSwitch,
      kitchenCopyButton,
      kitchenFeedbackButton,
      kitchenAlertButton,
      kitchenConfirmButton,
      kitchenKeyboardDismissButton,
      kitchenVibrationButton,
      kitchenMediaPickerButton,
      kitchenLocationButton,
      kitchenToastButton,
      kitchenLayoutAnimationButton,
      kitchenSecureSaveButton,
      kitchenSecureDeleteButton,
      kitchenAppExitButton,
      kitchenDeferredButton,
      kitchenActionSheetButton,
      kitchenLinkButton,
      kitchenShareButton,
    ] = childInvocations
    Expect.Is(outerText, AST.isViewRender)
    Expect.Is(shadowedText, AST.isViewRender)
    Expect.Is(nestedText, AST.isViewRender)
    Expect.Is(literalText, AST.isViewRender)
    Expect.Is(claimedText, AST.isViewRender)
    Expect.Is(countText, AST.isViewRender)
    Expect.Is(fixedNameText, AST.isViewRender)
    Expect.Is(profileNameText, AST.isViewRender)
    Expect.Is(tagText, AST.isViewRender)
    Expect.Is(kitchenImage, AST.isViewRender)
    Expect.Is(imageStatusText, AST.isViewRender)
    Expect.Is(indicatorStatusText, AST.isViewRender)
    Expect.Is(resourceStatusText, AST.isViewRender)
    Expect.Is(resourceMutationStatusText, AST.isViewRender)
    Expect.Is(kitchenResourceText, AST.isViewRender)
    Expect.Is(kitchenResourceMutationButton, AST.isViewRender)
    Expect.Is(kitchenStorageText, AST.isViewRender)
    Expect.Is(kitchenStorageSaveButton, AST.isViewRender)
    Expect.Is(networkStatusText, AST.isViewRender)
    Expect.Is(kitchenNetworkText, AST.isViewRender)
    Expect.Is(nativeColorStatusText, AST.isViewRender)
    Expect.Is(kitchenNativeColorText, AST.isViewRender)
    Expect.Is(nativeListStatusText, AST.isViewRender)
    Expect.Is(kitchenNativeList, AST.isViewRender)
    Expect.Is(kitchenSectionList, AST.isViewRender)
    Expect.Is(refreshStack, AST.isViewRender)
    Expect.Is(scrollStack, AST.isViewRender)
    Expect.Is(keyboardAvoidingStack, AST.isViewRender)
    Expect.Is(safeAreaStack, AST.isViewRender)
    Expect.Is(screen, AST.isViewRender)
    Expect.Is(modalSheet, AST.isViewRender)
    Expect.Is(permissionsAndroidStatusText, AST.isViewRender)
    Expect.Is(kitchenAndroidPermissionText, AST.isViewRender)
    Expect.Is(animatedStatusText, AST.isViewRender)
    Expect.Is(kitchenAnimatedText, AST.isViewRender)
    Expect.Is(deviceStatusText, AST.isViewRender)
    Expect.Is(kitchenViewportText, AST.isViewRender)
    Expect.Is(easingStatusText, AST.isViewRender)
    Expect.Is(kitchenEasingText, AST.isViewRender)
    Expect.Is(pixelRatioStatusText, AST.isViewRender)
    Expect.Is(kitchenPixelRatioText, AST.isViewRender)
    Expect.Is(panResponderStatusText, AST.isViewRender)
    Expect.Is(kitchenPanResponderText, AST.isViewRender)
    Expect.Is(platformStatusText, AST.isViewRender)
    Expect.Is(kitchenPlatformText, AST.isViewRender)
    Expect.Is(i18nStatusText, AST.isViewRender)
    Expect.Is(kitchenI18nText, AST.isViewRender)
    Expect.Is(inputAccessoryStatusText, AST.isViewRender)
    Expect.Is(kitchenInputAccessoryText, AST.isViewRender)
    Expect.Is(safeAreaStatusText, AST.isViewRender)
    Expect.Is(kitchenSafeAreaPaddingText, AST.isViewRender)
    Expect.Is(statusBarStatusText, AST.isViewRender)
    Expect.Is(kitchenStatusBar, AST.isViewRender)
    Expect.Is(styleSheetStatusText, AST.isViewRender)
    Expect.Is(kitchenStyleSheetText, AST.isViewRender)
    Expect.Is(modalStatusText, AST.isViewRender)
    Expect.Is(kitchenModalOptionsText, AST.isViewRender)
    Expect.Is(refreshControlStatusText, AST.isViewRender)
    Expect.Is(kitchenRefreshingText, AST.isViewRender)
    Expect.Is(toggleStatusText, AST.isViewRender)
    Expect.Is(kitchenToggleValueText, AST.isViewRender)
    Expect.Is(boundaryStatusText, AST.isViewRender)
    Expect.Is(boundaryLoading, AST.isViewRender)
    Expect.Is(navigationRoot, AST.isViewRender)
    Expect.Is(surfaceStatusText, AST.isViewRender)
    Expect.Is(themedStatusText, AST.isViewRender)
    Expect.Is(themedStack, AST.isViewRender)
    Expect.Is(formRoot, AST.isViewRender)
    Expect.Is(formValidationStatusText, AST.isViewRender)
    Expect.Is(asyncActionStatusText, AST.isViewRender)
    Expect.Is(pressableStateStatusText, AST.isViewRender)
    Expect.Is(clipboardStatusText, AST.isViewRender)
    Expect.Is(linkingStatusText, AST.isViewRender)
    Expect.Is(feedbackStatusText, AST.isViewRender)
    Expect.Is(mediaStatusText, AST.isViewRender)
    Expect.Is(secureStoreStatusText, AST.isViewRender)
    Expect.Is(locationStatusText, AST.isViewRender)
    Expect.Is(shareStatusText, AST.isViewRender)
    Expect.Is(actionSheetIOSStatusText, AST.isViewRender)
    Expect.Is(alertStatusText, AST.isViewRender)
    Expect.Is(keyboardStatusText, AST.isViewRender)
    Expect.Is(toastAndroidStatusText, AST.isViewRender)
    Expect.Is(vibrationStatusText, AST.isViewRender)
    Expect.Is(interactionManagerStatusText, AST.isViewRender)
    Expect.Is(layoutAnimationStatusText, AST.isViewRender)
    Expect.Is(appStateStatusText, AST.isViewRender)
    Expect.Is(kitchenAppStateText, AST.isViewRender)
    Expect.Is(appearanceStatusText, AST.isViewRender)
    Expect.Is(kitchenAppearanceText, AST.isViewRender)
    Expect.Is(accessibilityInfoStatusText, AST.isViewRender)
    Expect.Is(kitchenAccessibilityPreferencesText, AST.isViewRender)
    Expect.Is(backHandlerStatusText, AST.isViewRender)
    Expect.Is(kitchenTextInput, AST.isViewRender)
    Expect.Is(kitchenNotesInput, AST.isViewRender)
    Expect.Is(kitchenPasswordInput, AST.isViewRender)
    Expect.Is(kitchenEmailInput, AST.isViewRender)
    Expect.Is(kitchenSearchInput, AST.isViewRender)
    Expect.Is(kitchenPhoneInput, AST.isViewRender)
    Expect.Is(kitchenURLInput, AST.isViewRender)
    Expect.Is(kitchenNumericInput, AST.isViewRender)
    Expect.Is(kitchenCodeInput, AST.isViewRender)
    Expect.Is(kitchenNameText, AST.isViewRender)
    Expect.Is(kitchenNumber, AST.isViewRender)
    Expect.Is(kitchenButton, AST.isViewRender)
    Expect.Is(kitchenDisabledButton, AST.isViewRender)
    Expect.Is(kitchenLoadingButton, AST.isViewRender)
    Expect.Is(kitchenSpinner, AST.isViewRender)
    Expect.Is(kitchenLargeSpinner, AST.isViewRender)
    Expect.Is(kitchenEmptyState, AST.isViewRender)
    Expect.Is(kitchenLoadingState, AST.isViewRender)
    Expect.Is(kitchenErrorState, AST.isViewRender)
    Expect.Is(kitchenInputAccessoryBar, AST.isViewRender)
    Expect.Is(kitchenToggleSwitch, AST.isViewRender)
    Expect.Is(kitchenDisabledToggleSwitch, AST.isViewRender)
    Expect.Is(kitchenCopyButton, AST.isViewRender)
    Expect.Is(kitchenFeedbackButton, AST.isViewRender)
    Expect.Is(kitchenAlertButton, AST.isViewRender)
    Expect.Is(kitchenConfirmButton, AST.isViewRender)
    Expect.Is(kitchenKeyboardDismissButton, AST.isViewRender)
    Expect.Is(kitchenVibrationButton, AST.isViewRender)
    Expect.Is(kitchenMediaPickerButton, AST.isViewRender)
    Expect.Is(kitchenLocationButton, AST.isViewRender)
    Expect.Is(kitchenToastButton, AST.isViewRender)
    Expect.Is(kitchenLayoutAnimationButton, AST.isViewRender)
    Expect.Is(kitchenSecureSaveButton, AST.isViewRender)
    Expect.Is(kitchenSecureDeleteButton, AST.isViewRender)
    Expect.Is(kitchenAppExitButton, AST.isViewRender)
    Expect.Is(kitchenDeferredButton, AST.isViewRender)
    Expect.Is(kitchenActionSheetButton, AST.isViewRender)
    Expect.Is(kitchenLinkButton, AST.isViewRender)
    Expect.Is(kitchenShareButton, AST.isViewRender)
    Expect(outerText.view.ref?.name).toBe('Text')
    Expect(shadowedText.view.ref?.name).toBe('Text')
    Expect(nestedText.view.ref?.name).toBe('Text')
    Expect(literalText.view.ref?.name).toBe('Text')
    Expect(claimedText.view.ref?.name).toBe('Text')
    Expect(countText.view.ref?.name).toBe('CountText')
    Expect(fixedNameText.view.ref?.name).toBe('Text')
    Expect(profileNameText.view.ref?.name).toBe('Text')
    Expect(tagText.view.ref?.name).toBe('TagText')
    Expect(kitchenImage.view.ref?.name).toBe('Image')
    Expect(imageStatusText.view.ref?.name).toBe('ImageStatusText')
    Expect(indicatorStatusText.view.ref?.name).toBe('IndicatorStatusText')
    Expect(resourceStatusText.view.ref?.name).toBe('ResourceStatusText')
    Expect(resourceMutationStatusText.view.ref?.name).toBe('ResourceMutationStatusText')
    Expect(kitchenResourceText.view.ref?.name).toBe('ResourceText')
    Expect(kitchenResourceMutationButton.view.ref?.name).toBe('ResourceMutationButton')
    Expect(kitchenStorageText.view.ref?.name).toBe('StorageText')
    Expect(kitchenStorageSaveButton.view.ref?.name).toBe('StorageSaveButton')
    Expect(networkStatusText.view.ref?.name).toBe('NetworkStatusText')
    Expect(kitchenNetworkText.view.ref?.name).toBe('NetworkText')
    Expect(nativeColorStatusText.view.ref?.name).toBe('NativeColorStatusText')
    Expect(kitchenNativeColorText.view.ref?.name).toBe('NativeColorText')
    Expect(nativeListStatusText.view.ref?.name).toBe('NativeListStatusText')
    Expect(kitchenNativeList.view.ref?.name).toBe('NativeList')
    Expect(kitchenSectionList.view.ref?.name).toBe('SectionList')
    Expect(refreshStack.view.ref?.name).toBe('RefreshStack')
    Expect(scrollStack.view.ref?.name).toBe('ScrollStack')
    Expect(keyboardAvoidingStack.view.ref?.name).toBe('KeyboardAvoidingStack')
    Expect(safeAreaStack.view.ref?.name).toBe('SafeAreaStack')
    Expect(screen.view.ref?.name).toBe('Screen')
    Expect(modalSheet.view.ref?.name).toBe('ModalSheet')
    Expect(permissionsAndroidStatusText.view.ref?.name).toBe('PermissionsAndroidStatusText')
    Expect(kitchenAndroidPermissionText.view.ref?.name).toBe('AndroidPermissionText')
    Expect(animatedStatusText.view.ref?.name).toBe('AnimatedStatusText')
    Expect(kitchenAnimatedText.view.ref?.name).toBe('AnimatedText')
    Expect(deviceStatusText.view.ref?.name).toBe('DeviceStatusText')
    Expect(kitchenViewportText.view.ref?.name).toBe('ViewportText')
    Expect(easingStatusText.view.ref?.name).toBe('EasingStatusText')
    Expect(kitchenEasingText.view.ref?.name).toBe('EasingText')
    Expect(pixelRatioStatusText.view.ref?.name).toBe('PixelRatioStatusText')
    Expect(kitchenPixelRatioText.view.ref?.name).toBe('PixelRatioText')
    Expect(panResponderStatusText.view.ref?.name).toBe('PanResponderStatusText')
    Expect(kitchenPanResponderText.view.ref?.name).toBe('PanResponderText')
    Expect(platformStatusText.view.ref?.name).toBe('PlatformStatusText')
    Expect(kitchenPlatformText.view.ref?.name).toBe('PlatformText')
    Expect(i18nStatusText.view.ref?.name).toBe('I18nStatusText')
    Expect(kitchenI18nText.view.ref?.name).toBe('I18nText')
    Expect(inputAccessoryStatusText.view.ref?.name).toBe('InputAccessoryStatusText')
    Expect(kitchenInputAccessoryText.view.ref?.name).toBe('InputAccessoryText')
    Expect(safeAreaStatusText.view.ref?.name).toBe('SafeAreaStatusText')
    Expect(kitchenSafeAreaPaddingText.view.ref?.name).toBe('SafeAreaPaddingText')
    Expect(statusBarStatusText.view.ref?.name).toBe('StatusBarStatusText')
    Expect(kitchenStatusBar.view.ref?.name).toBe('StatusBar')
    Expect(styleSheetStatusText.view.ref?.name).toBe('StyleSheetStatusText')
    Expect(kitchenStyleSheetText.view.ref?.name).toBe('StyleSheetText')
    Expect(modalStatusText.view.ref?.name).toBe('ModalStatusText')
    Expect(kitchenModalOptionsText.view.ref?.name).toBe('ModalOptionsText')
    Expect(refreshControlStatusText.view.ref?.name).toBe('RefreshControlStatusText')
    Expect(kitchenRefreshingText.view.ref?.name).toBe('RefreshingText')
    Expect(toggleStatusText.view.ref?.name).toBe('ToggleStatusText')
    Expect(kitchenToggleValueText.view.ref?.name).toBe('ToggleValueText')
    Expect(boundaryStatusText.view.ref?.name).toBe('BoundaryStatusText')
    Expect(boundaryLoading.view.ref?.name).toBe('BoundaryLoading')
    Expect(navigationRoot.view.ref?.name).toBe('NavigationRoot')
    Expect(surfaceStatusText.view.ref?.name).toBe('SurfaceStatusText')
    Expect(themedStatusText.view.ref?.name).toBe('ThemedStatusText')
    Expect(themedStack.view.ref?.name).toBe('ThemedStack')
    Expect(formRoot.view.ref?.name).toBe('FormRoot')
    Expect(formValidationStatusText.view.ref?.name).toBe('FormValidationStatusText')
    Expect(asyncActionStatusText.view.ref?.name).toBe('AsyncActionStatusText')
    Expect(pressableStateStatusText.view.ref?.name).toBe('PressableStateStatusText')
    Expect(clipboardStatusText.view.ref?.name).toBe('ClipboardStatusText')
    Expect(linkingStatusText.view.ref?.name).toBe('LinkingStatusText')
    Expect(feedbackStatusText.view.ref?.name).toBe('FeedbackStatusText')
    Expect(mediaStatusText.view.ref?.name).toBe('MediaStatusText')
    Expect(secureStoreStatusText.view.ref?.name).toBe('SecureStoreStatusText')
    Expect(locationStatusText.view.ref?.name).toBe('LocationStatusText')
    Expect(shareStatusText.view.ref?.name).toBe('ShareStatusText')
    Expect(actionSheetIOSStatusText.view.ref?.name).toBe('ActionSheetIOSStatusText')
    Expect(alertStatusText.view.ref?.name).toBe('AlertStatusText')
    Expect(keyboardStatusText.view.ref?.name).toBe('KeyboardStatusText')
    Expect(toastAndroidStatusText.view.ref?.name).toBe('ToastAndroidStatusText')
    Expect(vibrationStatusText.view.ref?.name).toBe('VibrationStatusText')
    Expect(interactionManagerStatusText.view.ref?.name).toBe('InteractionManagerStatusText')
    Expect(layoutAnimationStatusText.view.ref?.name).toBe('LayoutAnimationStatusText')
    Expect(appStateStatusText.view.ref?.name).toBe('AppStateStatusText')
    Expect(kitchenAppStateText.view.ref?.name).toBe('AppStateText')
    Expect(appearanceStatusText.view.ref?.name).toBe('AppearanceStatusText')
    Expect(kitchenAppearanceText.view.ref?.name).toBe('AppearanceText')
    Expect(accessibilityInfoStatusText.view.ref?.name).toBe('AccessibilityInfoStatusText')
    Expect(kitchenAccessibilityPreferencesText.view.ref?.name).toBe('AccessibilityPreferencesText')
    Expect(backHandlerStatusText.view.ref?.name).toBe('BackHandlerStatusText')
    Expect(kitchenTextInput.view.ref?.name).toBe('TextInput')
    Expect(kitchenNotesInput.view.ref?.name).toBe('TextArea')
    Expect(kitchenPasswordInput.view.ref?.name).toBe('PasswordInput')
    Expect(kitchenEmailInput.view.ref?.name).toBe('EmailInput')
    Expect(kitchenSearchInput.view.ref?.name).toBe('SearchInput')
    Expect(kitchenPhoneInput.view.ref?.name).toBe('PhoneInput')
    Expect(kitchenURLInput.view.ref?.name).toBe('URLInput')
    Expect(kitchenNumericInput.view.ref?.name).toBe('NumericInput')
    Expect(kitchenCodeInput.view.ref?.name).toBe('OneTimeCodeInput')
    Expect(kitchenNameText.view.ref?.name).toBe('Text')
    Expect(kitchenNumber.view.ref?.name).toBe('Number')
    Expect(kitchenButton.view.ref?.name).toBe('Button')
    Expect(kitchenDisabledButton.view.ref?.name).toBe('DisabledButton')
    Expect(kitchenLoadingButton.view.ref?.name).toBe('LoadingButton')
    Expect(kitchenSpinner.view.ref?.name).toBe('Spinner')
    Expect(kitchenLargeSpinner.view.ref?.name).toBe('LargeSpinner')
    Expect(kitchenEmptyState.view.ref?.name).toBe('EmptyState')
    Expect(kitchenLoadingState.view.ref?.name).toBe('LoadingState')
    Expect(kitchenErrorState.view.ref?.name).toBe('ErrorState')
    Expect(kitchenInputAccessoryBar.view.ref?.name).toBe('InputAccessoryBar')
    Expect(kitchenToggleSwitch.view.ref?.name).toBe('ToggleSwitch')
    Expect(kitchenDisabledToggleSwitch.view.ref?.name).toBe('DisabledToggleSwitch')
    Expect(kitchenCopyButton.view.ref?.name).toBe('CopyButton')
    Expect(kitchenFeedbackButton.view.ref?.name).toBe('FeedbackButton')
    Expect(kitchenAlertButton.view.ref?.name).toBe('AlertButton')
    Expect(kitchenConfirmButton.view.ref?.name).toBe('ConfirmButton')
    Expect(kitchenKeyboardDismissButton.view.ref?.name).toBe('KeyboardDismissButton')
    Expect(kitchenVibrationButton.view.ref?.name).toBe('VibrationButton')
    Expect(kitchenMediaPickerButton.view.ref?.name).toBe('MediaPickerButton')
    Expect(kitchenLocationButton.view.ref?.name).toBe('LocationButton')
    Expect(kitchenToastButton.view.ref?.name).toBe('ToastButton')
    Expect(kitchenLayoutAnimationButton.view.ref?.name).toBe('LayoutAnimationButton')
    Expect(kitchenSecureSaveButton.view.ref?.name).toBe('SecureSaveButton')
    Expect(kitchenSecureDeleteButton.view.ref?.name).toBe('SecureDeleteButton')
    Expect(kitchenAppExitButton.view.ref?.name).toBe('AppExitButton')
    Expect(kitchenDeferredButton.view.ref?.name).toBe('DeferredButton')
    Expect(kitchenActionSheetButton.view.ref?.name).toBe('ActionSheetButton')
    Expect(kitchenLinkButton.view.ref?.name).toBe('LinkButton')
    Expect(kitchenShareButton.view.ref?.name).toBe('ShareButton')

    const [
      greetingArg,
      shadowArg,
      nestedArg,
      literalArg,
      claimedArg,
      countArg,
      fixedNameArg,
      profileNameArg,
      tagArg,
      kitchenCountArg,
      kitchenButtonAction,
    ] = [
      AST.argumentsOf(outerText)[0]?.value,
      AST.argumentsOf(shadowedText)[0]?.value,
      AST.argumentsOf(nestedText)[0]?.value,
      AST.argumentsOf(literalText)[0]?.value,
      AST.argumentsOf(claimedText)[0]?.value,
      AST.argumentsOf(countText)[0]?.value,
      AST.argumentsOf(fixedNameText)[0]?.value,
      AST.argumentsOf(profileNameText)[0]?.value,
      AST.argumentsOf(tagText)[0]?.value,
      AST.argumentsOf(kitchenNumber)[0]?.value,
      AST.argumentsOf(kitchenButton)[1]?.value,
    ]
    Expect.Is(greetingArg, AST.isValueReference)
    Expect.Is(shadowArg, AST.isValueReference)
    Expect.Is(nestedArg, AST.isValueReference)
    Expect.Is(literalArg, AST.isStringLiteral)
    Expect.Is(claimedArg, AST.isStringLiteral)
    Expect.Is(countArg, AST.isValueReference)
    Expect.Is(fixedNameArg, AST.isValueReference)
    Expect.Is(profileNameArg, AST.isMemberAccessExpression)
    Expect.Is(tagArg, AST.isMemberAccessExpression)
    Expect.Is(kitchenCountArg, AST.isValueReference)
    Expect.Is(kitchenButtonAction, AST.isValueReference)
    Expect(valueDeclarationName(greetingArg.target.ref)).toBe('OuterGreeting')
    Expect(valueDeclarationName(shadowArg.target.ref)).toBe('LocalText')
    Expect(valueDeclarationName(nestedArg.target.ref)).toBe('Greeting')
    Expect(literalArg.value).toBe('Hello World')
    Expect(claimedArg.value).toBe('Claimed space')
    Expect(AST.layoutEntriesOf(claimedText.layoutClause).map(layoutEntryTerms)).toEqual([
      ['claim', 2],
    ])
    Expect(valueDeclarationName(countArg.target.ref)).toBe('LaunchCount')
    Expect(valueDeclarationName(fixedNameArg.target.ref)).toBe('FixedSinkName')
    Expect(valueDeclarationName(profileNameArg.target.ref)).toBe('SinkProfileValue')
    Expect(profileNameArg.members).toEqual(['SinkName'])
    Expect(valueDeclarationName(tagArg.target.ref)).toBe('SinkProfileValue')
    Expect(tagArg.members).toEqual(['SinkTags'])
    Expect(kitchenCountArg.target.ref).toBe(kitchenCountState)
    Expect(valueDeclarationName(kitchenButtonAction.target.ref)).toBe('AddKitchenCount')

    Expect(countTextView.name).toBe('CountText')
    const countParameter = AST.parametersOf(countTextView)[0]
    Expect.Is(countParameter, AST.isParameterDeclaration)
    Expect(Type.parameterName(countParameter)).toBe('Count')
    Expect.Is(countParameter.inlineType?.type, AST.isPrimitiveTypeReference)
    Expect(countParameter.inlineType.type.primitive).toBe('number')
    const countRender = AST.blockStatementOf(countTextView, 0)
    Expect.Is(countRender, AST.isRenderStatement)
    Expect(countRender.injection?.tsCodeBlock).toContain('Launch count:')
    Expect.Is(countRender.injection, AST.isInjection)
    Expect(AST.injectionArgumentsOf(countRender.injection)).toHaveLength(1)
  })

  Test('parses inject render declarations', async () => {
    const parseResult = await testParseCode('view Native { render inject ```ts\nreturn null\n``` }')
    const view = parseResult.entry.ast.statements[0]

    Expect.Is(view, AST.isViewDeclaration)

    const render = AST.blockStatementOf(view, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect(render.injection?.tsCodeBlock).toContain('return null')
  })

  Test('parses layout declarations and child view invocations', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render Stack {
          alias Local = "Inside"
          Text Local { }
          Text "Literal"
        }
      }
      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      view Text Value is text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const layout = parseResult.entry.ast.statements.find(AST.isLayoutDeclaration)
    Expect.Is(layout, AST.isLayoutDeclaration)
    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isViewDeclaration)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)
    const [_localAlias, firstChild, secondChild] = AST.statementsOf(render.block)
    Expect.Is(firstChild, AST.isViewRender)
    Expect.Is(secondChild, AST.isViewRender)
    Expect(firstChild.view.ref?.name).toBe('Text')
    Expect(secondChild.view.ref?.name).toBe('Text')
  })

  Test('parses layout clauses on render sites', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render Col [claim 2, content top spread-inset, gap 12, pad 16, margin horizontal 4, width fill] {
          Text "Label" [width fill, height fill, id labelText, label "Label text", role "text"]
        }
      }
      layout Col {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
      view Text Value is text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)
    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isViewDeclaration)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect(AST.argumentsOf(render)).toHaveLength(0)
    const entries = AST.layoutEntriesOf(render.layoutClause)
    Expect(entries).toHaveLength(6)
    Expect(layoutEntryTerms(entries[0]!)).toEqual(['claim', 2])
    Expect(layoutEntryTerms(entries[1]!)).toEqual(['content', 'top', 'spread-inset'])
    Expect(layoutEntryTerms(entries[2]!)).toEqual(['gap', 12])
    Expect(layoutEntryTerms(entries[3]!)).toEqual(['pad', 16])
    Expect(layoutEntryTerms(entries[4]!)).toEqual(['margin', 'horizontal', 4])
    Expect(layoutEntryTerms(entries[5]!)).toEqual(['width', 'fill'])

    const child = AST.statementsOf(render.block).find(AST.isViewRender)
    Expect.Is(child, AST.isViewRender)
    Expect(AST.argumentsOf(child)).toHaveLength(1)
    Expect.Is(AST.argumentsOf(child)[0]?.value, AST.isStringLiteral)
    Expect(AST.layoutEntriesOf(child.layoutClause).map(layoutEntryTerms)).toEqual([
      ['width', 'fill'],
      ['height', 'fill'],
      ['id', 'labelText'],
      ['label', 'Label text'],
      ['role', 'text'],
    ])
  })

  Test('parses empty brackets after a render target as an empty layout clause', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render Col []
      }
      layout Col {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `)

    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isViewDeclaration)
    const render = AST.blockStatementOf(mainView, 0)
    Expect.Is(render, AST.isRenderStatement)
    Expect(AST.argumentsOf(render)).toHaveLength(0)
    Expect(AST.layoutEntriesOf(render.layoutClause)).toHaveLength(0)
  })

  Test('parses aliases, literals is number, and value references', async () => {
    const parseResult = await testParseCode(`
      alias Greeting = "Hello"
      alias LaunchCount = 3

      view Text Value is text { }
      view StatTile Label is text, Count is number { }
      view MainView Label is text {
        alias LocalLabel = Label
        render Text LocalLabel { }
        render StatTile Greeting, LaunchCount { }
      }
    `)

    const [greetingAlias, launchCountAlias, _textView, _statTileView, mainView] = parseResult.entry.ast.statements

    Expect.Is(greetingAlias, AST.isAliasDeclaration)
    Expect.Is(launchCountAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isViewDeclaration)

    Expect.Is(greetingAlias.value, AST.isStringLiteral)
    Expect.Is(launchCountAlias.value, AST.isNumberLiteral)
    Expect(launchCountAlias.value.value).toBe(3)
    const mainViewParameter = AST.parametersOf(mainView)[0]
    Expect.Is(mainViewParameter, AST.isParameterDeclaration)
    Expect.Is(mainViewParameter.inlineType?.type, AST.isPrimitiveTypeReference)
    Expect(mainViewParameter.inlineType.type.primitive).toBe('text')

    const [localAlias, textRender, statRender] = mainView.block.statements
    Expect.Is(localAlias, AST.isAliasDeclaration)
    Expect.Is(textRender, AST.isRenderStatement)
    Expect.Is(statRender, AST.isRenderStatement)

    Expect.Is(localAlias.value, AST.isValueReference)
    Expect(valueDeclarationName(localAlias.value.target.ref)).toBe('Label')

    const textArg = AST.argumentsOf(textRender)[0]?.value
    Expect.Is(textArg, AST.isValueReference)
    Expect(valueDeclarationName(textArg.target.ref)).toBe('LocalLabel')

    const statArgs = AST.argumentsOf(statRender).map(argument => argument.value)
    Expect(statArgs.map(AST.isValueReference)).toEqual([true, true])
    const [labelArg, countArg] = statArgs
    Expect.Is(labelArg, AST.isValueReference)
    Expect.Is(countArg, AST.isValueReference)
    Expect(valueDeclarationName(labelArg.target.ref)).toBe('Greeting')
    Expect(valueDeclarationName(countArg.target.ref)).toBe('LaunchCount')
  })

  Test('parses state declarations and action values', async () => {
    const parseResult = await testParseCode(`
      app CounterApp { view MainView }

      view Button Title is text, Action is action { }

      view MainView {
        state Count = 0

        action AddStep Step is number {
          set Count += Step
        }

        action AddFive {
          do AddStep 5
        }

        render Button "Add five", action {
          set Count = 0
        }
        render Button "Inline", -> {
          set Count *= 2
        }
      }
    `)

    const mainView = parseResult.entry.ast.statements.find(statement =>
      AST.isViewDeclaration(statement) && statement.name === 'MainView'
    )
    Expect.Is(mainView, AST.isViewDeclaration)

    const [countState, addStep, addFive, resetRender, inlineRender] = mainView.block.statements
    Expect.Is(countState, AST.isStateDeclaration)
    Expect.Is(addStep, AST.isActionDeclaration)
    Expect.Is(addFive, AST.isActionDeclaration)
    Expect.Is(resetRender, AST.isRenderStatement)
    Expect.Is(inlineRender, AST.isRenderStatement)

    const [setStep] = addStep.block.statements
    Expect.Is(setStep, AST.isSetStatement)
    Expect(setStep.target.ref).toBe(countState)
    Expect(setStep.operator).toBe('+=')
    Expect.Is(setStep.value, AST.isValueReference)
    Expect(setStep.value.target.ref).toBe(AST.parametersOf(addStep)[0])

    const [doAddStep] = addFive.block.statements
    Expect.Is(doAddStep, AST.isDoStatement)
    Expect.Is(doAddStep.action, AST.isValueReference)
    Expect(doAddStep.action.target.ref).toBe(addStep)
    Expect.Is(AST.argumentsOf(doAddStep)[0]?.value, AST.isNumberLiteral)

    Expect.Is(AST.argumentsOf(resetRender)[1]?.value, AST.isActionExpression)
    Expect.Is(AST.argumentsOf(inlineRender)[1]?.value, AST.isActionExpression)
  })

  Test('parses v0 Tao test declarations', async () => {
    const parseResult = await testParseCode(`
      app MyApp { view MainView }
      view MainView {
        render inject \`\`\`ts
          return null
        \`\`\`
      }

      test "Smoke" {
        check "renders text" {
          run MyApp

          expect text "Hello"
          press text "Add"
          input text "Name" "Grace"
          expect missing text "Loading"
        }
      }
    `)

    const test = parseResult.entry.ast.statements.find(AST.isTestDeclaration)
    Expect.Is(test, AST.isTestDeclaration)
    Expect(test.name).toBe('Smoke')
    const [check] = test.block.statements
    Expect.Is(check, AST.isCheckDeclaration)
    Expect(check.name).toBe('renders text')
    const [run, expectedText, pressText, inputText, missingText] = check.block.statements
    Expect.Is(run, AST.isRunStep)
    Expect(run.app.ref?.name).toBe('MyApp')
    Expect.Is(expectedText, AST.isExpectTextStep)
    Expect(expectedText.selector).toBe('text')
    Expect(expectedText.text).toBe('Hello')
    Expect(expectedText.missing).toBe(false)
    Expect.Is(pressText, AST.isPressTextStep)
    Expect(pressText.selector).toBe('text')
    Expect(pressText.text).toBe('Add')
    Expect.Is(inputText, AST.isInputTextStep)
    Expect(inputText.selector).toBe('text')
    Expect(inputText.target).toBe('Name')
    Expect(inputText.value).toBe('Grace')
    Expect.Is(missingText, AST.isExpectTextStep)
    Expect(missingText.selector).toBe('text')
    Expect(missingText.text).toBe('Loading')
    Expect(missingText.missing).toBe(true)
  })

  Test('parses the Kitchen Sink v0 Tao test sidecar', async () => {
    const parseResult = await Workspace.parse(kitchenSinkTestPath)

    Expect(parseResult.diagnostics).toEqual([])
    const [useStatement, test] = parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importedDeclarations[0]?.ref?.name).toBe('KitchenSink')
    Expect.Is(test, AST.isTestDeclaration)
    Expect(test.block.statements.filter(AST.isCheckDeclaration)).toHaveLength(13)
  })

  Test('does not discover test sidecars from app directory imports', async () => {
    await withTaoFiles(
      'tao-parser-sidecar-',
      {
        'Main.tao': `
        app MyApp { view MainView }
        use SharedView from ./
        view MainView {
          render SharedView
        }
      `,
        'Shared.tao': `
        project view SharedView {
          render inject \`\`\`ts
            return null
          \`\`\`
        }
      `,
        'Main.test.tao': `
        test "Sidecar" {
          check "intentionally incomplete" {
            expect text "This file should not load"
          }
        }
      `,
      },
      async paths => {
        const parseResult = await Workspace.parse(paths['Main.tao']!)
        const parsedFiles = parseResult.files.map(file => FS.basename(file.path))

        Expect(parsedFiles).toContain('Main.tao')
        Expect(parsedFiles).toContain('Shared.tao')
        Expect(parsedFiles).not.toContain('Main.test.tao')
      },
    )
  })

  Test('resolves value references through nested scope shadowing', async () => {
    const parseResult = await testParseCode(`
      alias Greeting = "File"

      layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      view Text Value is text {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
      view MainView Label is text {
        alias Greeting = "View"
        alias LabelAlias = Label
        render Stack {
          alias Greeting = "Block"
          Text Greeting
          Stack {
            alias Greeting = "Nested"
            Text Greeting
          }
          Text LabelAlias
        }
      }
    `)

    const [fileGreetingAlias, _stackView, _textView, mainView] = parseResult.entry.ast.statements
    Expect.Is(fileGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(mainView, AST.isViewDeclaration)

    const labelParameter = AST.parametersOf(mainView)[0]
    Expect.Is(labelParameter, AST.isParameterDeclaration)

    const [viewGreetingAlias, labelAlias, render] = mainView.block.statements
    Expect.Is(viewGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(labelAlias, AST.isAliasDeclaration)
    Expect.Is(render, AST.isRenderStatement)
    Expect.Is(labelAlias.value, AST.isValueReference)
    Expect(labelAlias.value.target.ref).toBe(labelParameter)

    const [blockGreetingAlias, blockText, nestedStack, labelText] = AST.statementsOf(render.block)
    Expect.Is(blockGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(blockText, AST.isViewRender)
    Expect.Is(nestedStack, AST.isViewRender)
    Expect.Is(labelText, AST.isViewRender)

    const blockTextValue = AST.argumentsOf(blockText)[0]?.value
    Expect.Is(blockTextValue, AST.isValueReference)
    Expect(blockTextValue.target.ref).toBe(blockGreetingAlias)

    const [nestedGreetingAlias, nestedText] = AST.statementsOf(nestedStack.block)
    Expect.Is(nestedGreetingAlias, AST.isAliasDeclaration)
    Expect.Is(nestedText, AST.isViewRender)

    const nestedTextValue = AST.argumentsOf(nestedText)[0]?.value
    Expect.Is(nestedTextValue, AST.isValueReference)
    Expect(nestedTextValue.target.ref).toBe(nestedGreetingAlias)

    const labelTextValue = AST.argumentsOf(labelText)[0]?.value
    Expect.Is(labelTextValue, AST.isValueReference)
    Expect(labelTextValue.target.ref).toBe(labelAlias)
    Expect(labelTextValue.target.ref).not.toBe(fileGreetingAlias)
  })

  Test('parses the Type System Tests app', async () => {
    const parseResult = await Workspace.parse(typeSystemTestsPath)

    Expect(parseResult.diagnostics).toEqual([])
    Expect(parseResult.entry.ast.statements.filter(AST.isTypeDeclaration).map(type => type.name)).toEqual([
      'Name',
      'Age',
      'Count',
      'Tags',
      'Job',
      'Person',
    ])
    Expect(parseResult.entry.ast.statements.filter(AST.isAliasDeclaration)).toHaveLength(11)
  })

  Test('parses type declarations, constructors, lists, and member access', async () => {
    const parseResult = await testParseCode(`
      type Name is text
      type Tags is list
      type Job is {
        Title is text
      }
      type Person is {
        Name
        Tags
        Job
      }

      alias DisplayName = Name "Ada"
      alias DemoTags = Tags ["types" "items"]
      alias DemoJob = Job { Title "Compiler engineer" }
      alias DemoPerson = Person { DisplayName DemoTags DemoJob }

      view Profile Person {
        render Text Person.Job.Title
      }
      view Text Value is text { }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const [nameType, tagsType, jobType, personType] = parseResult.entry.ast.statements.filter(AST.isTypeDeclaration)
    Expect.Is(nameType, AST.isTypeDeclaration)
    Expect.Is(tagsType, AST.isTypeDeclaration)
    Expect.Is(jobType, AST.isTypeDeclaration)
    Expect.Is(personType, AST.isTypeDeclaration)
    Expect(nameType?.name).toBe('Name')
    Expect(tagsType?.name).toBe('Tags')
    Expect.Is(jobType.type, AST.isItemTypeExpression)
    Expect.Is(personType.type, AST.isItemTypeExpression)

    const [displayName, demoTags, demoJob, demoPerson] = parseResult.entry.ast.statements.filter(AST.isAliasDeclaration)
    Expect.Is(displayName, AST.isAliasDeclaration)
    Expect.Is(demoTags, AST.isAliasDeclaration)
    Expect.Is(demoJob, AST.isAliasDeclaration)
    Expect.Is(demoPerson, AST.isAliasDeclaration)
    Expect.Is(displayName.value, AST.isTypedConstructor)
    Expect.Is(demoTags.value, AST.isTypedConstructor)
    Expect.Is(demoTags.value.value, AST.isListLiteral)
    Expect.Is(demoJob.value, AST.isTypedConstructor)
    Expect.Is(demoJob.value.value, AST.isItemLiteral)
    Expect.Is(demoPerson.value, AST.isTypedConstructor)

    const profile = parseResult.entry.ast.statements.find(
      statement => AST.isViewDeclaration(statement) && statement.name === 'Profile',
    )
    Expect.Is(profile, AST.isViewDeclaration)
    const render = AST.blockStatementOf(profile, 0)
    Expect.Is(render, AST.isRenderStatement)
    const argument = AST.argumentsOf(render)[0]?.value
    Expect.Is(argument, AST.isMemberAccessExpression)
    Expect(argument.members).toEqual(['Job', 'Title'])
  })

  Test('resolves nested item property constructor types', async () => {
    const parseResult = await testParseCode(`
      type Job is {
        Title is text
      }
      type Profile is {
        Role is Job
      }
      alias DemoProfile = Profile { Role { Title "Compiler engineer" } }
      view MainView { }
    `)

    Expect(parseResult.diagnostics).toEqual([])
    const profile = parseResult.entry.ast.statements.find(
      statement => AST.isTypeDeclaration(statement) && statement.name === 'Profile',
    )
    const alias = parseResult.entry.ast.statements.find(
      statement => AST.isAliasDeclaration(statement) && statement.name === 'DemoProfile',
    )
    Expect.Is(profile, AST.isTypeDeclaration)
    Expect.Is(profile.type, AST.isItemTypeExpression)
    Expect.Is(alias, AST.isAliasDeclaration)
    Expect.Is(alias.value, AST.isTypedConstructor)
    Expect.Is(alias.value.value, AST.isItemLiteral)
    const role = alias.value.value.properties[0]?.value
    Expect.Is(role, AST.isTypedConstructor)
    Expect.Is(role.type, AST.isNamedTypeReference)
    Expect(role.type.root).toBe('Role')
  })

  Test('parses the Runtime Stdlib Tests app', async () => {
    const parseResult = await Workspace.parse(runtimeStdlibTestsPath)

    Expect(parseResult.diagnostics).toEqual([])
    Expect(parseResult.entry.ast.statements.filter(AST.isUseStatement)).toHaveLength(1)
  })

  Test('parses Tao source strings', async () => {
    const source = `
      app InlineApp { view MainView }
      view MainView {
        render inject \`\`\`ts
          return null
        \`\`\`
      }
    `
    const parseResult = await testParseCode(source)

    Expect(parseResult.entry.ast.statements).toHaveLength(2)
    Expect.Is(parseResult.entry.ast.statements[0], AST.isAppDeclaration)
  })

  Test('parses use statements and project-visible declarations', async () => {
    const parseResult = await testParseSyntax(`
      app MyApp { view MainView }
      use Text, Stack from ./
      project alias Greeting = "Hello"
      project view MainView {
        render Stack {
          Text Greeting
        }
      }
      project layout Stack {
        render inject \`\`\`ts
          return <>{_ViewProps.children}</>
        \`\`\`
      }
      project view Text Value is text {
        render inject Value \`\`\`ts
          return <RN.Text>{Value}</RN.Text>
        \`\`\`
      }
    `)

    const [, useStatement, sharedAlias, mainView] = parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual(['Text', 'Stack'])
    Expect(useStatement.importPath).toBe('./')
    Expect.Is(sharedAlias, AST.isAliasDeclaration)
    Expect(sharedAlias.visibility).toBe('project')
    Expect.Is(mainView, AST.isViewDeclaration)
    Expect(mainView.visibility).toBe('project')
  })

  Test('parses parent-directory imports with trailing slashes', async () => {
    const parseResult = await testParseSyntax(`
      use Text from ../
    `)

    const [useStatement] = parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importPath).toBe('../')
  })

  Test('parses bare use statements', async () => {
    const parseResult = await testParseSyntax(`
      use Text
      project view Text Value is text {
        render inject Value \`\`\`ts
          return null
        \`\`\`
      }
    `)

    const [useStatement] = parseResult.entry.ast.statements
    Expect.Is(useStatement, AST.isUseStatement)
    Expect(useStatement.importedDeclarations.map(reference => reference.$refText)).toEqual(['Text'])
    Expect(useStatement.importPath).toBeUndefined()
  })

  Test('parses local package import paths', async () => {
    const parseResult = await testParseSyntax(`
      use Text from @bar
      use Label from @bar/forms
    `)

    Expect(parseResult.entry.document.parseResult.lexerErrors).toEqual([])
    Expect(parseResult.entry.document.parseResult.parserErrors).toEqual([])
    const [packageUse, subfolderUse] = parseResult.entry.ast.statements
    Expect.Is(packageUse, AST.isUseStatement)
    Expect.Is(subfolderUse, AST.isUseStatement)
    Expect(packageUse.importPath).toBe('@bar')
    Expect(subfolderUse.importPath).toBe('@bar/forms')
  })

  Test('parses project package visibility declarations', async () => {
    const parseResult = await testParseCode(`
      package alias PackageTitle = "Package"
      project view ProjectView { }
      publish layout PublishedStack { }
    `)

    const [packageAlias, projectView, publishedLayout] = parseResult.entry.ast.statements
    Expect.Is(packageAlias, AST.isAliasDeclaration)
    Expect.Is(projectView, AST.isViewDeclaration)
    Expect.Is(publishedLayout, AST.isLayoutDeclaration)
    Expect(packageAlias.visibility).toBe('package')
    Expect(projectView.visibility).toBe('project')
    Expect(publishedLayout.visibility).toBe('publish')
  })

  Test('keeps project visibility scoped out of stdlib imports', () => {
    const stdlibResolution: Packages.Resolution = {
      relation: 'stdlib',
      targetPath: '/tao-stdlib/tao/ui',
      candidateMode: 'direct',
      importPath: '@tao/ui',
    }

    Expect(Packages.isVisible('project', stdlibResolution)).toBe(false)
    Expect(Packages.isVisible('publish', stdlibResolution)).toBe(true)
  })

  Test('parses local project metadata', async () => {
    const parseResult = await testParseCode(`
      project {
        name "Package Access"
        remote none
        license MIT
      }
    `)

    const [project] = parseResult.entry.ast.statements
    Expect.Is(project, AST.isProjectDeclaration)
    Expect(AST.blockStatementOf(project, { map: statement => statement.$type })).toEqual([
      AST.ProjectName.$type,
      AST.ProjectRemote.$type,
      AST.ProjectLicense.$type,
    ])
  })
})

function layoutEntryTerms(entry: AST.LayoutEntry): Array<string | number> {
  return ASTUtils.layoutEntryValues(entry)
}

function valueDeclarationName(declaration: AST.ValueDeclaration | undefined): string | undefined {
  if (!declaration) {
    return undefined
  }
  return AST.isParameterDeclaration(declaration) ? Type.parameterName(declaration) : declaration.name
}

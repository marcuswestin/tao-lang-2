import { installNativeAbortSupport } from '@runtime/TR-native-abort'
import { registerRootComponent } from 'expo'
import type { ComponentType } from 'react'

installNativeAbortSupport()
const { CompanionPlaceholder } = require('./src/CompanionPlaceholder') as { CompanionPlaceholder: ComponentType }

/*
 * The companion shell holds no Studio logic. Tao Studio serves the real bundle from its own Metro and
 * opens the installed shell on it through the dev-client deep link, so this root renders only when
 * the shell loads its own bundle, which never happens in the Studio flow.
 */
registerRootComponent(CompanionPlaceholder)

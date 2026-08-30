import React from 'react'
import type { TaoNavigationCommand } from './TR-navigation-host-slots'
import { requireReactNativeRuntime } from './TR-react-native'

type CommandRole = 'button' | 'menuitem'

type FontAwesomeIcon = React.ComponentType<any> & {
  getRawGlyphMap?: () => Readonly<Record<string, number>>
  hasIcon?: (name: string) => boolean
}

/** NavigationCommandButton keeps icon metadata visual while the accessible name remains Label. */
export function NavigationCommandButton(props: {
  command: TaoNavigationCommand
  onInvoke?: () => void
  role?: CommandRole
  testID?: string
}): React.JSX.Element {
  const runtime = requireReactNativeRuntime()
  const Icon = props.command.icon ? fontAwesomeIcon() : undefined
  const icon = supportedIcon(props.command.icon, Icon)
  const fallbackGlyph = props.command.icon ? iconFallbacks[props.command.icon]?.fallback : undefined
  return React.createElement(
    runtime.Pressable,
    {
      accessibilityLabel: props.command.label,
      accessibilityRole: props.role ?? 'button',
      accessibilityState: { disabled: !props.command.enabled },
      disabled: !props.command.enabled,
      onPress: props.command.enabled
        ? () => {
          props.onInvoke?.()
          return props.command.invoke()
        }
        : undefined,
      testID: props.testID,
    },
    React.createElement(
      runtime.View,
      { style: commandContentStyle },
      icon
        ? React.createElement(Icon!, {
          accessible: false,
          name: icon.glyph as any,
          size: 16,
          testID: navigationCommandIconTestId(icon.source),
        })
        : fallbackGlyph
        ? React.createElement(runtime.Text, {
          accessible: false,
          children: fallbackGlyph,
          testID: navigationCommandIconTestId(props.command.icon!),
        })
        : null,
      React.createElement(runtime.Text, { accessible: false }, props.command.label),
    ),
  )
}

function supportedIcon(
  name: string | undefined,
  Icon: FontAwesomeIcon | undefined,
): { glyph: string; source: string } | undefined {
  if (!name || !Icon) {
    return undefined
  }
  const glyph = iconFallbacks[name]?.fontAwesome ?? name
  const supported = Icon.hasIcon?.(glyph) ?? Icon.getRawGlyphMap?.()[glyph] !== undefined
  return supported ? { glyph, source: name } : undefined
}

let cachedFontAwesomeIcon: FontAwesomeIcon | null | undefined

/** overrideNavigationCommandIconForTest exercises optional icon adapters without package resolution. */
export function overrideNavigationCommandIconForTest(icon: React.ComponentType<any>): () => void {
  const previous = cachedFontAwesomeIcon
  cachedFontAwesomeIcon = icon as FontAwesomeIcon
  return () => {
    cachedFontAwesomeIcon = previous
  }
}

function fontAwesomeIcon(): FontAwesomeIcon | undefined {
  if (cachedFontAwesomeIcon === undefined) {
    try {
      const module = require('@expo/vector-icons/FontAwesome6') as {
        default?: FontAwesomeIcon
      }
      cachedFontAwesomeIcon = module.default ?? null
    } catch {
      cachedFontAwesomeIcon = null
    }
  }
  return cachedFontAwesomeIcon ?? undefined
}

export const navigationCommandIconTestId = (name: string): string => `__tao_navigation_command_icon:${name}`

const commandContentStyle = { alignItems: 'center', flexDirection: 'row', gap: 6 } as const
const iconFallbacks: Readonly<Record<string, { fallback: string; fontAwesome: string }>> = Object.freeze({
  checkmark: { fallback: '✓', fontAwesome: 'check' },
  safari: { fallback: '◉', fontAwesome: 'safari' },
  'square.and.arrow.up': { fallback: '↗', fontAwesome: 'share-from-square' },
})

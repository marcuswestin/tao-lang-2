import { Switch } from '@shared/core'
import React from 'react'

type PressableState = { pressed?: boolean }
type StyleInput = ((state: PressableState) => unknown) | readonly unknown[] | unknown

export type TaoPrimitiveStyleKind =
  | 'Image'
  | 'KeyboardAvoidingView'
  | 'Pressable'
  | 'SafeAreaView'
  | 'PressableLabel'
  | 'ScrollView'
  | 'Text'
  | 'TextInput'
  | 'View'
export type TaoPalette = {
  readonly accent: string
  readonly accentPressed: string
  readonly background: string
  readonly border: string
  readonly mutedText: string
  readonly panel: string
  readonly surface: string
  readonly text: string
  readonly textOnAccent: string
}
export type TaoPaletteInput = Partial<TaoPalette>

const defaultPalette = {
  accent: '#2563eb',
  accentPressed: '#1d4ed8',
  background: '#f8fafc',
  border: '#cbd5e1',
  mutedText: '#64748b',
  panel: '#ffffff',
  surface: '#f1f5f9',
  text: '#111827',
  textOnAccent: '#ffffff',
} as const satisfies TaoPalette

const StyleContext = React.createContext<TaoPalette>(defaultPalette)

type StyleProviderProps = {
  children?: React.ReactNode
  palette?: TaoPaletteInput
}

/** StyleProvider applies Tao visual token overrides to rendered descendants. */
function StyleProvider(props: StyleProviderProps): React.JSX.Element {
  const parentPalette = React.useContext(StyleContext)
  const palette = React.useMemo(
    () => ({ ...parentPalette, ...props.palette }),
    [parentPalette, props.palette],
  )
  return React.createElement(StyleContext.Provider, { value: palette }, props.children)
}

function textStyle(palette: TaoPalette) {
  return {
    color: palette.text,
    fontSize: 16,
    lineHeight: 22,
  } as const
}

function pressableStyle(palette: TaoPalette) {
  return {
    alignItems: 'center',
    backgroundColor: palette.accent,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
  } as const
}

function pressableLabelStyle(palette: TaoPalette) {
  return {
    color: palette.textOnAccent,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
  } as const
}

function textInputStyle(palette: TaoPalette) {
  return {
    backgroundColor: palette.panel,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    color: palette.text,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  } as const
}

function imageStyle(): Record<string, unknown> {
  return {
    alignSelf: 'stretch',
    backgroundColor: '#e5e7eb',
    borderRadius: 8,
    minHeight: 96,
  }
}

function surfaceStyle(palette: TaoPalette) {
  return {
    alignItems: 'center',
    backgroundColor: palette.surface,
    borderColor: palette.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    justifyContent: 'center',
    minHeight: 96,
    paddingHorizontal: 16,
    paddingVertical: 18,
  } as const
}

function surfaceTitleStyle(palette: TaoPalette) {
  return {
    color: palette.text,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
  } as const
}

function surfaceMessageStyle(palette: TaoPalette) {
  return {
    color: palette.mutedText,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  } as const
}

function surfaceActionStyle(palette: TaoPalette) {
  return {
    alignItems: 'center',
    backgroundColor: palette.accent,
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 8,
  } as const
}

function surfaceActionTextStyle(palette: TaoPalette) {
  return {
    color: palette.textOnAccent,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
    textAlign: 'center',
  } as const
}

/** StyleControls exposes deterministic Tao visual defaults. */
export const StyleControls = {
  palette: defaultPalette,
  Provider: StyleProvider,
} as const

/** StyleRuntime exposes native style helpers for Tao runtime rendering. */
export const StyleRuntime = {
  appContentStyle,
  appRootStyle,
  primitiveNativeProps,
  primitiveStyle,
  surfaceActionStyle,
  surfaceActionTextStyle,
  surfaceMessageStyle,
  surfaceStyle,
  surfaceTitleStyle,
  usePalette,
} as const

function appContentStyle(): Record<string, unknown> {
  return {
    flexGrow: 1,
    minHeight: '100%',
    width: '100%',
  }
}

function appRootStyle(palette: TaoPalette): Record<string, unknown> {
  return {
    backgroundColor: palette.background,
    flex: 1,
  }
}

function primitiveNativeProps(
  kind: TaoPrimitiveStyleKind,
  props: Record<string, unknown>,
  palette: TaoPalette,
): Record<string, unknown> {
  return {
    ...props,
    placeholderTextColor: kind === 'TextInput'
      ? props['placeholderTextColor'] ?? palette.mutedText
      : props['placeholderTextColor'],
    style: appendStyle(
      appendStyle(
        primitiveStyle(kind, palette),
        kind === 'Pressable' && props['disabled'] === true ? { opacity: 0.6 } : undefined,
      ),
      props['style'],
    ),
  }
}

function primitiveStyle(kind: TaoPrimitiveStyleKind, palette: TaoPalette): StyleInput {
  return Switch(kind, {
    Image: () => imageStyle(),
    KeyboardAvoidingView: () => undefined,
    Pressable: () => pressableStyle(palette),
    PressableLabel: () => pressableLabelStyle(palette),
    SafeAreaView: () => undefined,
    ScrollView: () => undefined,
    Text: () => textStyle(palette),
    TextInput: () => textInputStyle(palette),
    View: () => undefined,
  })
}

function usePalette(): TaoPalette {
  return React.useContext(StyleContext)
}

function appendStyle(base: StyleInput, next: StyleInput): StyleInput {
  if (!base) {
    return next
  }
  if (!next) {
    return base
  }
  if (typeof base === 'function') {
    return (state: PressableState) => appendStyle(base(state), next)
  }
  if (typeof next === 'function') {
    return (state: PressableState) => appendStyle(base, next(state))
  }
  return Array.isArray(next) ? [base, ...next] : [base, next]
}

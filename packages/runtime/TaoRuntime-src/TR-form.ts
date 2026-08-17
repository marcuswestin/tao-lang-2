import {
  type FieldValues,
  type Path,
  useController,
  type UseControllerProps,
  useForm,
  type UseFormReturn,
} from 'react-hook-form'
import type { TaoTextInputBlurAction, TaoTextInputChangeAction } from './TR-views'

export type TaoForm<T extends FieldValues> = UseFormReturn<T>

export type TaoSubmitAction = {
  invoke(): void
}

export type TaoSubmitValidAction<T extends FieldValues> = {
  invoke(values: T): void
}

export type TaoTextField = {
  error?: string
  invalid: boolean
  onBlur(): void
  onChangeText(value: string): void
  value: string
}

export type TaoTextInputAction = TaoTextInputChangeAction

type TaoTextFieldOptions = {
  required?: boolean | string
}

/** Form exposes React Hook Form-backed helpers for generated Tao app forms. */
export const Form = {
  /** use creates one form state controller for a generated view. */
  use<T extends FieldValues>(options: { defaultValues: T }): TaoForm<T> {
    return useForm<T>({
      defaultValues: options.defaultValues as any,
      mode: 'onChange',
    })
  },

  /** submitAction adapts form submission to a generated Pressable-compatible action. */
  submitAction<T extends FieldValues>(form: TaoForm<T>, valid: TaoSubmitValidAction<T>): TaoSubmitAction {
    return {
      invoke() {
        void form.handleSubmit(values => valid.invoke(values))()
      },
    }
  },

  /** validAction adapts valid form values to a generated submit action. */
  validAction<T extends FieldValues>(work: (values: T) => void): TaoSubmitValidAction<T> {
    return {
      invoke(values) {
        work(values)
      },
    }
  },

  /** textInputAction adapts a form text field to a generated TextInput change action. */
  textInputAction(field: TaoTextField): TaoTextInputAction {
    return {
      invoke(value) {
        field.onChangeText(value.evaluate().jsValue)
      },
    }
  },

  /** textBlurAction adapts a form text field to a generated TextInput blur action. */
  textBlurAction(field: TaoTextField): TaoTextInputBlurAction {
    return {
      invoke() {
        field.onBlur()
      },
    }
  },

  /** textField binds a named form field to React Native TextInput-compatible props and validation state. */
  textField<T extends FieldValues>(form: TaoForm<T>, name: Path<T>, options: TaoTextFieldOptions = {}): TaoTextField {
    const { field, fieldState } = useController<T, Path<T>>({
      control: form.control,
      name,
      rules: textFieldRules(options),
    })
    return {
      error: fieldState.error?.message,
      invalid: fieldState.invalid,
      onBlur: field.onBlur,
      onChangeText: field.onChange,
      value: field.value === undefined ? '' : String(field.value),
    }
  },
} as const

function textFieldRules<T extends FieldValues>(options: TaoTextFieldOptions): UseControllerProps<T, Path<T>>['rules'] {
  return {
    required: options.required === undefined || options.required === false
      ? undefined
      : typeof options.required === 'string'
      ? options.required
      : 'Required',
  }
}

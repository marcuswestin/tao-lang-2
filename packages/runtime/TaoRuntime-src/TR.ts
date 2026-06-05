import React from 'react'

class RuntimeValue<T> {
  constructor(readonly jsValue: T) {}

  evaluate(): TR.Value<T> {
    return this
  }
}

class RuntimeAlias<T> {
  constructor(private readonly value: TR.Value<T>) {}

  evaluate(): TR.Value<T> {
    return this.value.evaluate()
  }
}

class RuntimeViewParameterList<Parameters extends TR.ViewParameterTypes> {
  constructor(readonly parameters: Parameters) {}
}

/** TR exposes the generated-code runtime API used by generated apps. */
class TR {
  private constructor() {}

  /** Value creates runtime Tao values from JavaScript values. */
  static readonly Value = RuntimeValue

  /** Alias creates runtime Tao aliases from Tao values. */
  static Alias<T>(value: TR.Value<T>): TR.Alias<T> {
    return new RuntimeAlias(value)
  }

  /** ViewParameterList creates a Tao ui parameter list from primitive parameter declarations. */
  static ViewParameterList<const Parameters extends TR.ViewParameterTypes>(
    parameters: Parameters,
  ): TR.ViewParameterList<Parameters> {
    return new RuntimeViewParameterList(parameters)
  }

  /** UiDeclaration creates a React component for a Tao ui declaration. */
  static UiDeclaration<Parameters extends TR.ViewParameterTypes>(
    name: string,
    parameterList: TR.ViewParameterList<Parameters>,
    render: (props: TR.ViewProps<Parameters>) => React.ReactNode,
  ): TR.View<Parameters> {
    void parameterList
    const TaoView: React.FC<TR.ViewProps<Parameters>> = props => render(props)
    TaoView.displayName = name
    return TaoView
  }

  /** ViewBlock evaluates a Tao ui block and falls back to children when the block is empty. */
  static ViewBlock(props: TR.ViewBaseProps, body: TR.ViewBlockBody): React.ReactNode {
    return this.renderNodeList(this.evaluateBody(body), props.children ?? null)
  }

  /** RenderProps creates React props for a Tao render statement. */
  static RenderProps<Props extends Record<string, TR.Value<unknown>>>(props: Props): Props {
    return props
  }

  /** RenderChildren evaluates child renders for a Tao render statement. */
  static RenderChildren(body: TR.ViewBlockBody): React.ReactNode {
    return this.renderNodeList(this.evaluateBody(body), null)
  }

  /** Render creates a React element from a Tao render statement. */
  static Render<Parameters extends TR.ViewParameterTypes>(
    view: TR.View<Parameters>,
    props: TR.ViewRenderProps<Parameters>,
    children?: React.ReactNode,
  ): React.ReactElement {
    const viewProps = children === undefined ? props : { ...props, children }
    return React.createElement(view, viewProps as TR.ViewProps<Parameters>)
  }

  private static evaluateBody(body: TR.ViewBlockBody): React.ReactNode | React.ReactNode[] {
    return typeof body === 'function' ? body() : body
  }

  private static renderNodeList(
    value: React.ReactNode | React.ReactNode[],
    fallback: React.ReactNode,
  ): React.ReactNode {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return fallback
      }
      return React.createElement(React.Fragment, null, ...value)
    }
    return value ?? fallback
  }
}

namespace TR {
  /** Value declares a runtime Tao value wrapper. */
  export type Value<T> = RuntimeValue<T>
  /** Alias declares a runtime Tao alias wrapper. */
  export type Alias<T> = RuntimeAlias<T>
  /** PrimitiveType declares Tao primitive runtime value names. */
  export type PrimitiveType = 'number' | 'text'
  /** PrimitiveValue maps a Tao primitive type to its JavaScript value type. */
  export type PrimitiveValue<TypeT extends PrimitiveType> = TypeT extends 'number' ? number : string
  /** ViewParameterTypes declares a Tao ui parameter-name to primitive-type map. */
  export type ViewParameterTypes = Record<string, PrimitiveType>
  /** ViewParameterList declares runtime metadata for Tao ui parameters. */
  export type ViewParameterList<Parameters extends ViewParameterTypes = ViewParameterTypes> = RuntimeViewParameterList<
    Parameters
  >
  /** ViewBaseProps declares shared React props for Tao views. */
  export type ViewBaseProps = {
    children?: React.ReactNode
  }
  /** ViewRenderProps declares the generated props for a Tao render invocation. */
  export type ViewRenderProps<Parameters extends ViewParameterTypes> = {
    [Name in keyof Parameters]: Value<PrimitiveValue<Parameters[Name]>>
  }
  /** ViewProps declares the full React props for a generated Tao ui component. */
  export type ViewProps<Parameters extends ViewParameterTypes> = ViewBaseProps & ViewRenderProps<Parameters>
  /** View declares a generated Tao ui React component. */
  export type View<Parameters extends ViewParameterTypes = ViewParameterTypes> = React.ComponentType<
    ViewProps<Parameters>
  >
  /** ViewBlockBody declares generated Tao ui block bodies accepted by the runtime. */
  export type ViewBlockBody = React.ReactNode | React.ReactNode[] | (() => React.ReactNode | React.ReactNode[])
}

export default TR

import React from 'react'
import { ErrorBoundary } from 'react-error-boundary'

type ErrorBoundaryProps = {
  children?: React.ReactNode
  fallback: React.ReactNode | ((error: unknown) => React.ReactNode)
}

type LoadingBoundaryProps = {
  children?: React.ReactNode
  fallback: React.ReactNode
}

/** Boundary exposes app-visible loading and error containment helpers. */
export const Boundary = {
  /** Error renders fallback UI when child rendering throws. */
  Error(props: ErrorBoundaryProps): React.JSX.Element {
    return React.createElement(ErrorBoundary, {
      fallbackRender: ({ error }) => typeof props.fallback === 'function' ? props.fallback(error) : props.fallback,
    }, props.children)
  },

  /** Loading renders fallback UI while child content suspends. */
  Loading(props: LoadingBoundaryProps): React.JSX.Element {
    return React.createElement(React.Suspense, { fallback: props.fallback }, props.children)
  },
} as const

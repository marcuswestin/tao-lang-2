import React from 'react'
import { Dev } from './dev-runtime/TR-dev'

/** createElement is the runtime's one element-creation point; every runtime module builds elements through it so
 * development tooling sees each element before React does. */
export const createElement: typeof React.createElement = ((...args: any[]) => {
  if (Dev.isLayoutBoundsEnabled()) {
    Dev.processCreateReactElementArgs(args)
  }
  return React.createElement.apply(React, args as any)
}) as typeof React.createElement

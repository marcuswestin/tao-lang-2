import { registerRootComponent } from 'expo'
import type { ComponentType } from 'react'

const generatedApp = require('./_gen_tao-app/App') as { default: ComponentType }

registerRootComponent(generatedApp.default)

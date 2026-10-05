import { MockModule } from '@shared/test'
import * as runtime from '../TaoRuntime-src/TR'

// App sidecars use the installed package name. Forward it to this checkout's real runtime
// without depending on an app-dev installation or its generated TypeScript configuration.
MockModule('@tao/runtime', () => runtime)

import { Platform } from '@shared'
import { StudioClientAssets } from '@studio'

const previewUrlMarker = '__TAO_STUDIO_DEV_PREVIEW_URL__'
const snapshot = {
  bundle: await StudioClientAssets.bundle(),
  html: StudioClientAssets.html({ previewUrl: previewUrlMarker }),
}

Platform.runtimeProcess.stdout.write(JSON.stringify(snapshot))

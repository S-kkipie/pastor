import type { CapacitorConfig } from '@capacitor/cli'

// The Android app wraps the same build the bridge serves (../bridge/web). It
// talks to a bridge on the tailnet over plain HTTP (tailscale serve --http),
// so the WebView runs on http:// and allows cleartext.
const config: CapacitorConfig = {
  appId: 'dev.pastor.app',
  appName: 'Pastor',
  webDir: '../bridge/web',
  backgroundColor: '#141011',
  server: { androidScheme: 'http', cleartext: true },
  android: { allowMixedContent: true },
}

export default config

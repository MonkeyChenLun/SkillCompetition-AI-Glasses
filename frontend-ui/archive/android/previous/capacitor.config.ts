import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.aiglasses.user',
  appName: 'AI Glasses 用户端',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
}

export default config

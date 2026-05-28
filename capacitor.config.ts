import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yrdly.app',
  appName: 'Yrdly',
  webDir: 'out',
  server: {
    // Point this to your live production URL
    url: 'https://app.yrdly.ng',
    cleartext: true
  }
};

export default config;

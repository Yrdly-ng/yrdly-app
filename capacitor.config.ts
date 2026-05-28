import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.yrdly.app',
  appName: 'Yrdly',
  webDir: 'out',
  server: {
    // Point this to your live production URL or local dev server IP
    url: 'https://yrdly-app.vercel.app',
    cleartext: true
  }
};

export default config;

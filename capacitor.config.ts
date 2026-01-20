import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bulletpoints.app',
  appName: 'Bulletpoints',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
import { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'com.bulletpoints.app',
  appName: 'Bulletpoints',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  plugins: {
    SplashScreen: {
      // Hidden by the app once content is ready (see hideSplash), so there's no flash of a loading screen
      launchAutoHide: false,
      launchFadeOutDuration: 150
    },
    Keyboard: {
      // iOS: resize the web view so the toolbar sits on top of the keyboard
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true
    }
  }
};

export default config;

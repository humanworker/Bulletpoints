import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { Browser } from '@capacitor/browser';
import { Share } from '@capacitor/share';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

export const isNative = Capacitor.isNativePlatform();

// Touch-first device (phone/tablet), regardless of screen width or user agent.
export const isTouchDevice = (): boolean => {
  if (isNative) return true;
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(pointer: coarse)').matches;
};

type HapticKind = 'selection' | 'light' | 'medium' | 'success';

export const haptic = (kind: HapticKind = 'light') => {
  if (!isNative) return;
  const run = () => {
    switch (kind) {
      case 'selection':
        return Haptics.selectionChanged();
      case 'light':
        return Haptics.impact({ style: ImpactStyle.Light });
      case 'medium':
        return Haptics.impact({ style: ImpactStyle.Medium });
      case 'success':
        return Haptics.notification({ type: NotificationType.Success });
    }
  };
  run()?.catch(() => {});
};

export const openExternalUrl = (url: string) => {
  if (isNative) {
    Browser.open({ url }).catch(() => window.open(url, '_blank'));
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

// Native share sheet for a text file (used for export on Android/iOS).
export const shareTextFile = async (fileName: string, text: string) => {
  const { uri } = await Filesystem.writeFile({
    path: fileName,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  await Share.share({ title: fileName, files: [uri] });
};

export const syncStatusBar = (isDarkMode: boolean) => {
  // Keep the browser chrome (PWA / mobile Safari / Chrome) in sync too
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', isDarkMode ? '#111827' : '#f9fafb');

  if (!isNative) return;
  StatusBar.setStyle({ style: isDarkMode ? Style.Dark : Style.Light }).catch(() => {});
  if (Capacitor.getPlatform() === 'android') {
    StatusBar.setBackgroundColor({ color: isDarkMode ? '#111827' : '#f9fafb' }).catch(() => {});
  }
};

export const hideSplash = () => {
  if (!isNative) return;
  SplashScreen.hide({ fadeOutDuration: 150 }).catch(() => {});
};

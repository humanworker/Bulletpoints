import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Keyboard } from '@capacitor/keyboard';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = Capacitor.isNativePlatform();

type HapticKind = 'tick' | 'light' | 'medium' | 'heavy';

export const haptic = (kind: HapticKind = 'light'): void => {
  if (!isNative) return;
  const run =
    kind === 'tick'
      ? Haptics.selectionStart().then(() => Haptics.selectionChanged()).then(() => Haptics.selectionEnd())
      : Haptics.impact({ style: kind === 'heavy' ? ImpactStyle.Heavy : kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
  run.catch(() => {});
};

export const openUrl = (url: string): void => {
  if (isNative) {
    Browser.open({ url }).catch(() => window.open(url, '_blank'));
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
};

export const hideSplash = (): void => {
  if (isNative) SplashScreen.hide({ fadeOutDuration: 120 }).catch(() => {});
};

// System bars take the page's colours, so the app reads as one uninterrupted surface
export const syncSystemBars = (): void => {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || (dark.matches ? '#000000' : '#f6f4ef');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    if (!isNative) return;
    StatusBar.setStyle({ style: dark.matches ? Style.Dark : Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: bg }).catch(() => {});
  };
  apply();
  dark.addEventListener('change', apply);
};

export const onBackButton = (handler: () => boolean): void => {
  if (!isNative) return;
  App.addListener('backButton', () => {
    if (!handler()) App.minimizeApp().catch(() => {});
  });
};

// Android's back gesture hides the keyboard without blurring the field
export const onKeyboardHidden = (handler: () => void): void => {
  if (!isNative) return;
  Keyboard.addListener('keyboardDidHide', handler).catch(() => {});
};

export const onAppResume = (handler: () => void): void => {
  if (!isNative) return;
  App.addListener('resume', handler).catch(() => {});
};

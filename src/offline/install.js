/**
 * How this browser installs the site as an app (openspec offline-app). Chrome and Edge fire
 * `beforeinstallprompt`, which is kept from start-up so an Install app button can open the
 * browser's own prompt later. Safari has no prompt: the steps are shown instead.
 */
let deferredPrompt = null;
const listeners = new Set();
const notify = () => listeners.forEach((fn) => fn());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); // shown from Settings instead of the browser's own banner
    deferredPrompt = event;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    notify();
  });
}

/** Calls `fn` when what installKind() returns may have changed; returns an unsubscribe. */
export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True when running as an installed app (its own window, no address bar). */
export function isInstalled() {
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone);
}

/** iPhone, iPod or iPad; iPads that ask for desktop sites say Mac, but have touch. */
export function isAppleMobile(nav = navigator) {
  if (/iPhone|iPad|iPod/.test(nav.userAgent)) return true;
  return nav.platform === 'MacIntel' && nav.maxTouchPoints > 1;
}

const isSafari = (nav = navigator) => /Safari\//.test(nav.userAgent) && !/Chrome\/|Chromium\/|CriOS\/|FxiOS\/|EdgiOS\/|Edg\//.test(nav.userAgent);

/**
 * 'installed', 'prompt' (Chrome/Edge can install: call promptInstall), 'ios-safari' (Share → Add to
 * Home Screen), 'ios-other' (other iOS browsers: open the site in Safari, or use the Share menu),
 * 'mac-safari' (File → Add to Dock) or 'other' (this browser can't install the app).
 */
export function installKind(nav = navigator) {
  if (isInstalled()) return 'installed';
  // iPad and iPhone browsers never offer the prompt; the Share menu is the way there
  if (isAppleMobile(nav)) return isSafari(nav) ? 'ios-safari' : 'ios-other';
  if (deferredPrompt) return 'prompt';
  if (isSafari(nav)) return 'mac-safari';
  return 'other';
}

/** Opens the browser's install prompt; resolves true when the user installed the app. */
export async function promptInstall() {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  notify();
  return outcome === 'accepted';
}

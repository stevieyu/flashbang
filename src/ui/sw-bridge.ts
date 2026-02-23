export function notifySW(type: string) {
  navigator.serviceWorker.controller?.postMessage({ type });
}

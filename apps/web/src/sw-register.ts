/* Registers the service worker after first paint (never blocks LCP, §1.1) and wires the
   polite update prompt: when a new SW is waiting, show a refresh affordance; on confirm,
   message skip-waiting and reload once the new SW takes control. */
export function registerSW(onUpdateReady: (apply: () => void) => void): void {
  if (!('serviceWorker' in navigator) || (import.meta as { env?: { DEV?: boolean } }).env?.DEV) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      const promote = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdateReady(() => worker.postMessage('skip-waiting'));
          }
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) {
        onUpdateReady(() => reg.waiting!.postMessage('skip-waiting'));
      }
      reg.addEventListener('updatefound', () => promote(reg.installing));
    }).catch(() => { /* SW is progressive enhancement; app works without it */ });

    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload(); // new SW took control -> load fresh shell
    });
  });
}

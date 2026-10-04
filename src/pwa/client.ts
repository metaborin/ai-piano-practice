import { PwaClient } from './PwaClient'

export const pwaClient = new PwaClient({
  events: window,
  visibility: document,
  online: () => navigator.onLine,
  visible: () => !document.hidden,
  displayMode: window.matchMedia('(display-mode: standalone)'),
  serviceWorker: navigator.serviceWorker,
  reload: () => window.location.reload(),
}, import.meta.env.BASE_URL, import.meta.env.PROD)

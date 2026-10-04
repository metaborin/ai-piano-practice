export interface InstallPrompt extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface PwaHost {
  events: EventTarget
  visibility: EventTarget
  online(): boolean
  visible(): boolean
  displayMode: EventTarget & { matches: boolean }
  serviceWorker?: ServiceWorkerContainer
  reload(): void
}

export interface PwaState {
  online: boolean
  standalone: boolean
  installAvailable: boolean
  offlineReady: boolean
  needRefresh: boolean
  updating: boolean
  checking: boolean
  message: string
}

/** Browser lifecycle only. No practice, MIDI, DOM, IndexedDB or Blob dependencies. */
export class PwaClient {
  private host: PwaHost
  private base: string
  private enabled: boolean
  private state: PwaState
  private listeners = new Set<() => void>()
  private cleanup: (() => void)[] = []
  private registration?: ServiceWorkerRegistration
  private installPrompt?: InstallPrompt
  private started = false
  private installed = false
  private beforeReload?: () => void
  private reloadRequested = false
  private reloaded = false
  private updateTimeout?: ReturnType<typeof setTimeout>
  private lastCheck = -Infinity

  constructor(host: PwaHost, base: string, enabled = true) {
    this.host = host; this.base = base; this.enabled = enabled
    this.state = { online: host.online(), standalone: host.displayMode.matches, installAvailable: false, offlineReady: false, needRefresh: false, updating: false, checking: false, message: '' }
  }

  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private patch(patch: Partial<PwaState>) {
    const next = { ...this.state, ...patch }
    if (Object.keys(patch).every(key => next[key as keyof PwaState] === this.state[key as keyof PwaState])) return
    this.state = next; this.listeners.forEach(listener => listener())
  }
  private listen(target: EventTarget, name: string, listener: EventListener) {
    target.addEventListener(name, listener)
    this.cleanup.push(() => target.removeEventListener(name, listener))
  }

  // Called once outside React's StrictMode lifecycle.
  start = async () => {
    if (this.started) return
    this.started = true
    const { host } = this
    this.listen(host.events, 'online', () => { this.patch({ online: true }); void this.checkForUpdate() })
    this.listen(host.events, 'offline', () => this.patch({ online: false }))
    this.listen(host.events, 'focus', () => { void this.checkForUpdate() })
    this.listen(host.visibility, 'visibilitychange', () => { if (host.visible()) void this.checkForUpdate() })
    this.listen(host.displayMode, 'change', () => {
      // Fullscreen can temporarily change display-mode in an installed window.
      const standalone = this.state.standalone || host.displayMode.matches
      this.patch({ standalone, installAvailable: !standalone && !this.installed && !!this.installPrompt })
    })
    this.listen(host.events, 'beforeinstallprompt', event => {
      event.preventDefault()
      this.installPrompt = event as InstallPrompt
      this.patch({ installAvailable: !this.state.standalone && !this.installed })
    })
    this.listen(host.events, 'appinstalled', () => {
      this.installed = true; this.installPrompt = undefined
      this.patch({ installAvailable: false })
    })
    const serviceWorker = host.serviceWorker
    if (!this.enabled || !serviceWorker) return
    let previousController = serviceWorker.controller
    this.listen(serviceWorker, 'controllerchange', () => {
      this.patch({ offlineReady: true })
      if (this.reloadRequested) this.finishUpdate()
      // Another window may approve activation. Never reload this window without consent.
      else if (previousController) this.patch({ needRefresh: true })
      previousController = serviceWorker.controller
    })
    try {
      const registration = await serviceWorker.register(`${this.base}sw.js`, { scope: this.base, updateViaCache: 'none' })
      if (!this.started) return
      this.registration = registration
      this.patch({ offlineReady: !!registration.active, message: '' })
      const inspect = () => {
        if (registration.waiting && (registration.active || serviceWorker.controller)) this.patch({ needRefresh: true })
        if (registration.active) this.patch({ offlineReady: true })
      }
      const watchInstalling = () => {
        const worker = registration.installing
        if (worker) this.listen(worker, 'statechange', () => {
          inspect()
          if (worker.state === 'redundant' && !registration.active) this.patch({ message: 'オフライン用の保存に失敗しました。オンラインで開き直してください。' })
        })
        inspect()
      }
      this.listen(registration, 'updatefound', watchInstalling)
      watchInstalling()
      const timer = setInterval(() => { if (host.visible()) void this.checkForUpdate() }, 60 * 60 * 1000)
      this.cleanup.push(() => clearInterval(timer))
      void this.checkForUpdate()
    } catch {
      if (this.started) this.patch({ message: 'オフライン用の保存を開始できませんでした。オンラインで開き直してください。' })
    }
  }

  checkForUpdate = async (manual = false) => {
    if (!this.registration || this.state.checking || !this.state.online || this.registration.installing) return
    if (!manual && Date.now() - this.lastCheck < 60_000) return
    this.lastCheck = Date.now()
    this.patch({ checking: true, message: '' })
    try {
      await this.registration.update()
      if (this.started && manual) this.patch({ message: '更新を確認しました。新しい版の保存が完了すると通知します。' })
    } catch {
      if (this.started && manual) this.patch({ message: '更新を確認できませんでした。接続を確認して、もう一度お試しください。' })
    } finally { if (this.started) this.patch({ checking: false }) }
  }

  install = async () => {
    const prompt = this.installPrompt
    if (!prompt || this.installed || this.state.standalone) return
    this.installPrompt = undefined
    this.patch({ installAvailable: false })
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice.outcome === 'accepted') this.installed = true
    } catch { /* A dismissed/unavailable browser prompt is not an app error. */ }
  }

  applyUpdate = (beforeReload: () => void) => {
    if (!this.state.needRefresh || this.state.updating) return
    this.beforeReload = beforeReload
    this.reloadRequested = true
    this.patch({ updating: true, message: '' })
    const waiting = this.registration?.waiting
    if (!waiting) { this.finishUpdate(); return }
    try {
      waiting.postMessage({ type: 'SKIP_WAITING' })
      this.updateTimeout = setTimeout(() => {
        this.reloadRequested = false; this.beforeReload = undefined
        this.patch({ updating: false, message: '更新を適用できませんでした。もう一度「更新する」を押してください。' })
      }, 15_000)
    } catch {
      this.reloadRequested = false; this.beforeReload = undefined
      this.patch({ updating: false, message: '更新を適用できませんでした。もう一度お試しください。' })
    }
  }

  private finishUpdate() {
    if (this.reloaded) return
    clearTimeout(this.updateTimeout)
    this.reloaded = true
    this.beforeReload?.()
    this.host.reload()
  }

  dispose = () => {
    this.started = false
    this.cleanup.splice(0).forEach(remove => remove())
    clearTimeout(this.updateTimeout)
  }
}

import { useSyncExternalStore } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferredPrompt: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach(l => l())
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  deferredPrompt = e as BeforeInstallPromptEvent
  notify()
})

window.addEventListener('appinstalled', () => {
  deferredPrompt = null
  notify()
})

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot() {
  return deferredPrompt !== null
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  await deferredPrompt.prompt()
  const choice = await deferredPrompt.userChoice
  deferredPrompt = null
  notify()
  return choice.outcome === 'accepted'
}

export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(subscribe, getSnapshot, () => false)
  return { canInstall, promptInstall }
}

export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  )
}

export function manualInstallInstructions(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) {
    return 'In Safari, tap the Share icon, then "Add to Home Screen".'
  }
  if (/Android/.test(ua)) {
    return 'Open the browser menu (⋮) and tap "Install app" or "Add to Home screen".'
  }
  return 'Open your browser menu and look for "Install app" or "Add to Home screen".'
}

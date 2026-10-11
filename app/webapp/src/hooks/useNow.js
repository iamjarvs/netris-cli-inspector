import { useSyncExternalStore } from 'react'

// One shared ticker for every component that shows "x min ago", instead of
// a timer per table row.
const listeners = new Set()
let timer = null
let current = Date.now()

function subscribe(listener) {
  listeners.add(listener)
  if (!timer) {
    timer = setInterval(() => {
      current = Date.now()
      listeners.forEach((l) => l())
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function useNow() {
  return useSyncExternalStore(subscribe, () => current)
}

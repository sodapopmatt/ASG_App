import { useState, useCallback } from 'react'

// Module-level: persists tab selections across navigation within the session
const tabMemory: Record<string, string> = {}

export function useTabMemory<T extends string>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => (tabMemory[key] as T) ?? defaultValue)

  const set = useCallback((v: T) => {
    tabMemory[key] = v
    setValue(v)
  }, [key])

  return [value, set]
}

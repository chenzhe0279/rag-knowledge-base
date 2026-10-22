const valueMemory = new Map<string, number>()

export function rememberNumber(key: string | undefined, value: number) {
  if (!key) return
  valueMemory.set(key, value)
}

export function recallNumber(key: string | undefined) {
  if (!key) return undefined
  return valueMemory.get(key)
}

export function clearNumberMemory(prefix?: string) {
  if (!prefix) {
    valueMemory.clear()
    return
  }

  for (const key of valueMemory.keys()) {
    if (key.startsWith(prefix)) valueMemory.delete(key)
  }
}

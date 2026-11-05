import { useEffect, useRef } from 'react'

/**
 * 条件轮询：enabled 为 true 时每 interval 毫秒调用一次 callback。
 * callback 通过 ref 保存，避免每次渲染重置定时器；页面隐藏时跳过本轮。
 */
export function usePolling(callback: () => void, interval: number, enabled: boolean) {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') callbackRef.current()
    }, interval)
    return () => window.clearInterval(timer)
  }, [enabled, interval])
}

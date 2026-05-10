'use client'

/**
 * Phase 7 — Pusher (browser side) hook.
 *
 * One singleton Pusher client per browser tab. `useChannel(channel,
 * event, handler)` subscribes for the duration of the component's
 * lifetime and unsubscribes on unmount.
 *
 * Connection-state aware: callers can read `connected` from the hook
 * to decide whether to fall back to polling. The dashboards currently
 * keep a 60-second poll fallback as a belt-and-braces guard against
 * Pusher disconnects.
 *
 * Fail-soft: if NEXT_PUBLIC_PUSHER_KEY isn't set we never instantiate
 * the client; `connected` stays false and `useChannel` is a no-op.
 */

import { useEffect, useRef, useState } from 'react'
import PusherClient, { type Channel } from 'pusher-js'

let _client: PusherClient | null = null
function client(): PusherClient | null {
  if (typeof window === 'undefined') return null
  if (_client) return _client
  const key     = process.env.NEXT_PUBLIC_PUSHER_KEY
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER ?? 'eu'
  if (!key) return null
  _client = new PusherClient(key, {
    cluster,
    authEndpoint: '/api/pusher/auth',
    authTransport: 'ajax',
  })
  return _client
}

/** Subscribe to a Pusher channel for the lifetime of the calling
 *  component. Cleans up on unmount. */
export function useChannel(
  channelName: string | null,
  event:       string,
  handler:     (data: unknown) => void,
) {
  // Stable ref so a parent re-render with a new `handler` reference
  // doesn't tear down + re-subscribe the channel. The ref value is
  // refreshed in an effect (React 19 doesn't allow ref writes during
  // render — `react-hooks/refs`).
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    const c = client()
    if (!c || !channelName) return
    const ch = c.subscribe(channelName)
    const cb = (data: unknown) => handlerRef.current(data)
    ch.bind(event, cb)
    return () => {
      ch.unbind(event, cb)
      c.unsubscribe(channelName)
    }
  }, [channelName, event])
}

/** Hook for components that just want to know "is Pusher up?" so they
 *  can swap their poll interval. */
export function useConnectionState(): { connected: boolean } {
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    const c = client()
    if (!c) return
    const update = () => setConnected(c.connection.state === 'connected')
    update()
    c.connection.bind('state_change', update)
    return () => { c.connection.unbind('state_change', update) }
  }, [])
  return { connected }
}

/** Subscribe to a presence channel and report the active members
 *  list (everyone else viewing the same case / dashboard). */
export function usePresence(channelName: string | null): {
  members: { id: string; info: Record<string, unknown> }[]
} {
  const [members, setMembers] = useState<{ id: string; info: Record<string, unknown> }[]>([])
  useEffect(() => {
    const c = client()
    if (!c || !channelName) return
    const ch = c.subscribe(channelName) as Channel & {
      members: { each: (cb: (m: { id: string; info: Record<string, unknown> }) => void) => void }
    }

    const refresh = () => {
      const arr: { id: string; info: Record<string, unknown> }[] = []
      ch.members?.each?.((m: { id: string; info: Record<string, unknown> }) => arr.push(m))
      setMembers(arr)
    }
    ch.bind('pusher:subscription_succeeded', refresh)
    ch.bind('pusher:member_added',          refresh)
    ch.bind('pusher:member_removed',        refresh)

    return () => {
      ch.unbind('pusher:subscription_succeeded', refresh)
      ch.unbind('pusher:member_added',          refresh)
      ch.unbind('pusher:member_removed',        refresh)
      c.unsubscribe(channelName)
    }
  }, [channelName])
  return { members }
}

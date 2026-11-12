// src/events/bus.ts

import type { SimEvent, EventType } from './types'

type Handler = (event: SimEvent) => void

export class EventBus {
  private handlers: Map<EventType | '*', Handler[]> = new Map()
  private buffer:   SimEvent[] = []

  emit(event: SimEvent): void {
    // Freeze to enforce immutability
    Object.freeze(event)
    Object.freeze(event.payload)

    this.buffer.push(event)

    // Notify type-specific handlers
    const typed = this.handlers.get(event.type)
    if (typed) typed.forEach(h => h(event))

    // Notify wildcard handlers
    const wild = this.handlers.get('*')
    if (wild) wild.forEach(h => h(event))
  }

  on(type: EventType | '*', handler: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, [])
    this.handlers.get(type)!.push(handler)
    return () => {
      const arr = this.handlers.get(type)
      if (arr) {
        const idx = arr.indexOf(handler)
        if (idx !== -1) arr.splice(idx, 1)
      }
    }
  }

  getBuffer(): readonly SimEvent[] {
    return this.buffer
  }

  getByType<T extends SimEvent>(type: T['type']): T[] {
    return this.buffer.filter(e => e.type === type) as T[]
  }

  getByAgent(agentId: string): SimEvent[] {
    return this.buffer.filter(e => e.agentId === agentId)
  }

  getByMerchant(merchantId: string): SimEvent[] {
    return this.buffer.filter(e => e.merchantId === merchantId)
  }

  getByTickRange(from: number, to: number): SimEvent[] {
    return this.buffer.filter(e => e.tick >= from && e.tick <= to)
  }

  /** Total event count — used in metrics */
  get count(): number { return this.buffer.length }
}

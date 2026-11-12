// src/payments/paypal/store.ts
// In-memory record of REAL Sandbox checkouts made through this app.
// PayPal remains the source of truth (we re-read the order from PayPal before acting);
// this store only adds ownership, a capture lock and an event log.
// Note: process memory — fine for a single-instance demo, lost on restart.

export type CheckoutStatus =
  | 'CREATED' | 'APPROVED' | 'CAPTURING' | 'COMPLETED' | 'PENDING'
  | 'CANCELLED' | 'REFUNDING' | 'REFUNDED' | 'FAILED'

export interface CheckoutRecord {
  orderId: string
  ownerId: string
  merchantId: string
  productId: string
  productName: string
  amountMinor: number
  currency: string
  status: CheckoutStatus
  approveUrl: string | null
  captureId: string | null
  refundId: string | null
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export type SandboxEventType =
  | 'PAYPAL_ORDER_CREATED' | 'PAYPAL_ORDER_APPROVED' | 'PAYPAL_CAPTURE_STARTED'
  | 'PAYPAL_CAPTURE_COMPLETED' | 'PAYPAL_CAPTURE_PENDING' | 'PAYPAL_CHECKOUT_CANCELLED'
  | 'PAYPAL_REFUND_COMPLETED' | 'PAYPAL_ERROR'

export interface SandboxEvent {
  id: string
  at: number
  type: SandboxEventType
  source: 'paypal_sandbox_real'
  orderId: string
  merchantId: string
  detail: Record<string, string | number | null>
}

interface Globals { __wtOrders?: Map<string, CheckoutRecord>; __wtEvents?: SandboxEvent[]; __wtSeq?: number }
const g = globalThis as unknown as Globals
const orders = (g.__wtOrders ??= new Map())
const events = (g.__wtEvents ??= [])

export const store = {
  get: (id: string) => orders.get(id),
  put(rec: CheckoutRecord) { orders.set(rec.orderId, rec) },
  listFor(ownerId: string) { return [...orders.values()].filter(r => r.ownerId === ownerId) },
  emit(type: SandboxEventType, rec: Pick<CheckoutRecord, 'orderId' | 'merchantId'>, detail: SandboxEvent['detail'] = {}) {
    g.__wtSeq = (g.__wtSeq ?? 0) + 1
    events.push({ id: `sbx_${g.__wtSeq}`, at: Date.now(), type, source: 'paypal_sandbox_real', orderId: rec.orderId, merchantId: rec.merchantId, detail })
    if (events.length > 200) events.splice(0, events.length - 200)
  },
  eventsFor(ownerId: string) {
    const mine = new Set(this.listFor(ownerId).map(r => r.orderId))
    return events.filter(e => mine.has(e.orderId))
  },
  reset() { orders.clear(); events.length = 0 },
}

/** What the browser may see. Never includes ownerId. */
export function publicView(r: CheckoutRecord) {
  const { ownerId: _omit, ...rest } = r
  void _omit
  return rest
}

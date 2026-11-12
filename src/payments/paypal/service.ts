// src/payments/paypal/service.ts
// Checkout orchestration with the safety rules:
//  - price/currency come from the server catalog, never the browser
//  - orders are only visible/actionable to the browser session that created them
//  - capture happens only after PayPal itself reports APPROVED (re-read from PayPal)
//  - amount + currency on PayPal's side must match what we asked for
//  - capture/refund are single-flight (status lock) and idempotent (PayPal-Request-Id)
import { randomUUID } from 'crypto'
import { PayPalError, formatMinor, type PayPalSandboxClient } from './client'
import { findProduct } from './catalog'
import { store, type CheckoutRecord, type CheckoutStatus } from './store'

export class CheckoutError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly code: string) {
    super(message)
    this.name = 'CheckoutError'
  }
}

const NOT_FOUND = () => new CheckoutError('Order not found', 404, 'NOT_FOUND')

function owned(orderId: string, ownerId: string): CheckoutRecord {
  const rec = store.get(orderId)
  if (!rec || rec.ownerId !== ownerId) throw NOT_FOUND() // same answer for "missing" and "not yours"
  return rec
}

function touch(rec: CheckoutRecord, patch: Partial<CheckoutRecord>) {
  Object.assign(rec, patch, { updatedAt: Date.now() })
}

function sameMoney(a: { currency_code: string; value: string } | null, minor: number, currency: string) {
  return !!a && a.currency_code === currency && a.value === formatMinor(minor)
}

export async function createCheckout(
  client: PayPalSandboxClient,
  ownerId: string,
  input: { merchantId?: unknown; productId?: unknown },
  origin: string,
): Promise<CheckoutRecord> {
  if (typeof input.merchantId !== 'string' || typeof input.productId !== 'string') {
    throw new CheckoutError('merchantId and productId are required', 400, 'BAD_REQUEST')
  }
  const product = findProduct(input.merchantId, input.productId)
  if (!product) throw new CheckoutError('Unknown merchant/product', 400, 'UNKNOWN_PRODUCT')

  const refId = `wt_${randomUUID().slice(0, 8)}`
  const order = await client.createOrder({
    amountMinor: product.amountMinor,
    currency: product.currency,
    description: `[SANDBOX] ${product.name} from ${product.merchantName}`,
    referenceId: refId,
    customId: `${product.merchantId}:${product.productId}`,
    requestId: `create-${randomUUID()}`,
    returnUrl: `${origin}/paypal/return`,
    cancelUrl: `${origin}/paypal/return?cancelled=1`,
  })
  if (!order.approveUrl) throw new CheckoutError('PayPal did not return an approval link', 502, 'NO_APPROVE_LINK')
  // PayPal's create response is minimal (no amount echo), so read the order back to verify it.
  const verified = order.amount ? order : await client.getOrder(order.id)
  if (!sameMoney(verified.amount, product.amountMinor, product.currency)) {
    throw new CheckoutError('PayPal order amount does not match the catalog', 502, 'AMOUNT_MISMATCH')
  }

  const now = Date.now()
  const rec: CheckoutRecord = {
    orderId: order.id, ownerId,
    merchantId: product.merchantId, productId: product.productId, productName: product.name,
    amountMinor: product.amountMinor, currency: product.currency,
    status: 'CREATED', approveUrl: order.approveUrl,
    captureId: null, refundId: null, lastError: null, createdAt: now, updatedAt: now,
  }
  store.put(rec)
  store.emit('PAYPAL_ORDER_CREATED', rec, { productId: rec.productId, amountMinor: rec.amountMinor, paypalStatus: order.status })
  return rec
}

/** Re-read the order from PayPal and sync our record. PayPal is the source of truth. */
export async function refreshCheckout(client: PayPalSandboxClient, ownerId: string, orderId: string): Promise<CheckoutRecord> {
  const rec = owned(orderId, ownerId)
  if (['CAPTURING', 'REFUNDING', 'REFUNDED', 'CANCELLED'].includes(rec.status)) return rec
  const remote = await client.getOrder(orderId)
  if (remote.status === 'APPROVED' && rec.status === 'CREATED') {
    touch(rec, { status: 'APPROVED' })
    store.emit('PAYPAL_ORDER_APPROVED', rec, { paypalStatus: remote.status })
  } else if (remote.status === 'COMPLETED' && remote.captureId && rec.status !== 'COMPLETED') {
    touch(rec, { status: remote.captureStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING', captureId: remote.captureId })
  } else if (remote.status === 'VOIDED') {
    touch(rec, { status: 'CANCELLED' })
  }
  return rec
}

export async function captureCheckout(client: PayPalSandboxClient, ownerId: string, orderId: string): Promise<CheckoutRecord> {
  const rec = owned(orderId, ownerId)

  // Duplicate-capture protection
  if (rec.status === 'COMPLETED' || rec.status === 'PENDING') return rec // already captured: return it, never call PayPal again
  if (rec.status === 'CAPTURING') throw new CheckoutError('A capture is already in progress for this order', 409, 'CAPTURE_IN_PROGRESS')
  if (rec.status === 'REFUNDED' || rec.status === 'REFUNDING') throw new CheckoutError('Order was already refunded', 409, 'ALREADY_REFUNDED')
  if (rec.status === 'CANCELLED') throw new CheckoutError('Checkout was cancelled', 409, 'CANCELLED')

  const previous = rec.status
  touch(rec, { status: 'CAPTURING', lastError: null }) // synchronous lock before any await
  store.emit('PAYPAL_CAPTURE_STARTED', rec)
  try {
    const remote = await client.getOrder(orderId)
    if (!sameMoney(remote.amount, rec.amountMinor, rec.currency)) {
      throw new CheckoutError('Order amount/currency on PayPal does not match what was requested', 409, 'AMOUNT_MISMATCH')
    }
    if (remote.status === 'COMPLETED' && remote.captureId) {
      // captured elsewhere (e.g. earlier request that timed out): adopt it
      return finishCapture(rec, remote.captureId, remote.captureStatus, remote.captureAmount)
    }
    if (remote.status !== 'APPROVED') {
      touch(rec, { status: previous })
      throw new CheckoutError('The buyer has not approved this order in PayPal yet', 409, 'NOT_APPROVED')
    }
    store.emit('PAYPAL_ORDER_APPROVED', rec, { paypalStatus: remote.status })
    const captured = await client.captureOrder(orderId, `capture-${orderId}`)
    if (!captured.captureId) throw new CheckoutError('PayPal returned no capture', 502, 'NO_CAPTURE')
    return finishCapture(rec, captured.captureId, captured.captureStatus, captured.captureAmount)
  } catch (err) {
    if ((rec.status as CheckoutStatus) === 'CAPTURING') touch(rec, { status: previous === 'CREATED' ? 'CREATED' : 'APPROVED' })
    const safe = err instanceof Error ? err.message : 'capture failed'
    if (!(err instanceof CheckoutError && err.code === 'NOT_APPROVED')) {
      touch(rec, { lastError: safe })
      store.emit('PAYPAL_ERROR', rec, { phase: 'capture', message: safe })
    }
    throw err
  }
}

function finishCapture(rec: CheckoutRecord, captureId: string, status: string | null, amount: { currency_code: string; value: string } | null) {
  if (amount && !sameMoney(amount, rec.amountMinor, rec.currency)) {
    touch(rec, { status: 'FAILED', captureId, lastError: 'Captured amount differs from order amount' })
    store.emit('PAYPAL_ERROR', rec, { phase: 'capture', message: 'captured amount mismatch' })
    throw new CheckoutError('Captured amount differs from the order amount', 502, 'CAPTURE_AMOUNT_MISMATCH')
  }
  if (status === 'COMPLETED') {
    touch(rec, { status: 'COMPLETED', captureId })
    store.emit('PAYPAL_CAPTURE_COMPLETED', rec, { captureId, amountMinor: rec.amountMinor })
  } else {
    touch(rec, { status: 'PENDING', captureId })
    store.emit('PAYPAL_CAPTURE_PENDING', rec, { captureId, paypalCaptureStatus: status })
  }
  return rec
}

export function cancelCheckout(ownerId: string, orderId: string): CheckoutRecord {
  const rec = owned(orderId, ownerId)
  if (rec.status !== 'CREATED' && rec.status !== 'APPROVED') {
    throw new CheckoutError(`Cannot cancel an order that is ${rec.status}`, 409, 'BAD_STATE')
  }
  touch(rec, { status: 'CANCELLED' })
  store.emit('PAYPAL_CHECKOUT_CANCELLED', rec)
  return rec
}

export async function refundCheckout(client: PayPalSandboxClient, ownerId: string, orderId: string): Promise<CheckoutRecord> {
  const rec = owned(orderId, ownerId)
  if (rec.status === 'REFUNDED') return rec // idempotent
  if (rec.status === 'REFUNDING') throw new CheckoutError('A refund is already in progress', 409, 'REFUND_IN_PROGRESS')
  if (rec.status !== 'COMPLETED' || !rec.captureId) throw new CheckoutError('Only a completed capture can be refunded', 409, 'BAD_STATE')

  touch(rec, { status: 'REFUNDING', lastError: null })
  try {
    const refund = await client.refundCapture(rec.captureId, {
      requestId: `refund-${orderId}`,
      amount: { currency_code: rec.currency, value: formatMinor(rec.amountMinor) },
      note: 'Sandbox refund from Commerce Wind Tunnel',
    })
    if (refund.status === 'COMPLETED' || refund.status === 'PENDING') {
      touch(rec, { status: 'REFUNDED', refundId: refund.id })
      store.emit('PAYPAL_REFUND_COMPLETED', rec, { refundId: refund.id, paypalRefundStatus: refund.status })
    } else {
      touch(rec, { status: 'COMPLETED', lastError: `Refund status ${refund.status}` })
    }
    return rec
  } catch (err) {
    touch(rec, { status: 'COMPLETED', lastError: err instanceof Error ? err.message : 'refund failed' })
    store.emit('PAYPAL_ERROR', rec, { phase: 'refund', message: rec.lastError })
    throw err
  }
}

/** Convert any thrown value to a safe HTTP response body. */
export function toHttpError(err: unknown): { status: number; body: { error: string; code: string; debugId?: string | undefined } } {
  if (err instanceof CheckoutError) return { status: err.httpStatus, body: { error: err.message, code: err.code } }
  if (err instanceof PayPalError) {
    return { status: 502, body: { error: err.message, code: err.code, debugId: err.debugId } }
  }
  return { status: 500, body: { error: 'Unexpected server error', code: 'INTERNAL' } }
}

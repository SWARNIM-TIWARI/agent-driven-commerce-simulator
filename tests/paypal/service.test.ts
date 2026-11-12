import { describe, it, expect, beforeEach } from 'vitest'
import { PayPalSandboxClient, readCredentials, formatMinor } from '../../src/payments/paypal/client'
import { createCheckout, captureCheckout, refundCheckout, cancelCheckout, refreshCheckout, toHttpError } from '../../src/payments/paypal/service'
import { store } from '../../src/payments/paypal/store'

// A tiny stateful fake of the PayPal Sandbox API (NOT real PayPal — it only proves our logic).
function fakePayPal() {
  const calls: string[] = []
  const orders = new Map<string, { status: string; value: string; currency: string; captureId?: string }>()
  let n = 0
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'paypal-debug-id': 'dbg123' } })
  const fetchImpl = async (url: string, init?: RequestInit) => {
    const path = url.replace('https://api-m.sandbox.paypal.com', '')
    const method = init?.method ?? 'GET'
    calls.push(`${method} ${path}`)
    if (path === '/v1/oauth2/token') return json({ access_token: 'tok', expires_in: 3600 })
    if (path === '/v2/checkout/orders' && method === 'POST') {
      const b = JSON.parse(init!.body as string)
      const id = `ORD${++n}`
      const amt = b.purchase_units[0].amount
      orders.set(id, { status: 'PAYER_ACTION_REQUIRED', value: amt.value, currency: amt.currency_code })
      return json({ id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] }, 201) // real PayPal does not echo the amount here
    }
    const m = path.match(/^\/v2\/checkout\/orders\/(\w+)(\/capture)?$/)
    if (m) {
      const o = orders.get(m[1]!)
      if (!o) return json({ name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] }, 404)
      if (m[2]) {
        if (o.status !== 'APPROVED') return json({ name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }], secret_echo: 'XYZ' }, 422)
        o.status = 'COMPLETED'; o.captureId = `CAP${m[1]}`
      }
      return json({
        id: m[1], status: o.status, links: [],
        purchase_units: [{ amount: { currency_code: o.currency, value: o.value }, payments: o.captureId ? { captures: [{ id: o.captureId, status: 'COMPLETED', amount: { currency_code: o.currency, value: o.value } }] } : undefined }],
      })
    }
    if (path.startsWith('/v2/payments/captures/') && path.endsWith('/refund')) return json({ id: 'REF1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '12.99' } }, 201)
    return json({}, 404)
  }
  return { fetchImpl, calls, orders }
}

const ORIGIN = 'http://localhost:3000'
let fake: ReturnType<typeof fakePayPal>
let client: PayPalSandboxClient
const A = 'owner-a', B = 'owner-b'
const approve = (id: string) => { fake.orders.get(id)!.status = 'APPROVED' }
const countCalls = (needle: string) => fake.calls.filter(c => c.includes(needle)).length

beforeEach(() => {
  store.reset()
  fake = fakePayPal()
  client = new PayPalSandboxClient({ clientId: 'id', clientSecret: 'super-secret' }, fake.fetchImpl)
})

describe('config', () => {
  it('refuses anything but sandbox mode', () => {
    expect(readCredentials({ PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b', PAYPAL_MODE: 'live' })).toBeNull()
    expect(readCredentials({ PAYPAL_CLIENT_ID: 'a', PAYPAL_CLIENT_SECRET: 'b', PAYPAL_MODE: 'sandbox' })).not.toBeNull()
    expect(readCredentials({})).toBeNull()
  })
  it('formats minor units exactly', () => {
    expect(formatMinor(1299)).toBe('12.99'); expect(formatMinor(5)).toBe('0.05'); expect(formatMinor(100)).toBe('1.00')
    expect(() => formatMinor(0)).toThrow(); expect(() => formatMinor(1.5)).toThrow()
  })
})

describe('create', () => {
  it('uses the SERVER catalog price and returns an approval URL', async () => {
    const rec = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_headphones' }, ORIGIN)
    expect(rec.amountMinor).toBe(1299)
    expect(fake.orders.get(rec.orderId)!.value).toBe('12.99')
    expect(rec.approveUrl).toContain('sandbox.paypal.com')
    expect(rec.status).toBe('CREATED')
  })
  it('ignores a client-supplied amount (no such input is accepted)', async () => {
    const rec = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_headphones', amount: 1 } as never, ORIGIN)
    expect(fake.orders.get(rec.orderId)!.value).toBe('12.99')
  })
  it('rejects unknown products and mismatched merchant/product', async () => {
    await expect(createCheckout(client, A, { merchantId: 'merchant_a', productId: 'nope' }, ORIGIN)).rejects.toMatchObject({ code: 'UNKNOWN_PRODUCT' })
    await expect(createCheckout(client, A, { merchantId: 'merchant_b', productId: 'alpha_headphones' }, ORIGIN)).rejects.toMatchObject({ code: 'UNKNOWN_PRODUCT' })
    await expect(createCheckout(client, A, {}, ORIGIN)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
  it('verifies the amount by reading the order back when create does not echo it', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_c', productId: 'gamma_webcam' }, ORIGIN)
    expect(r.amountMinor).toBe(1199)
    expect(fake.calls.some(c => c.startsWith('GET /v2/checkout/orders/'))).toBe(true)
  })
  it('caches the OAuth token across calls', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_charger' }, ORIGIN)
    await refreshCheckout(client, A, r.orderId)
    expect(countCalls('/v1/oauth2/token')).toBe(1)
  })
})

describe('capture', () => {
  it('does NOT capture before the buyer approves', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_b', productId: 'beta_mouse' }, ORIGIN)
    await expect(captureCheckout(client, A, r.orderId)).rejects.toMatchObject({ code: 'NOT_APPROVED', httpStatus: 409 })
    expect(countCalls('/capture')).toBe(0)
    expect(store.get(r.orderId)!.status).toBe('CREATED')
  })
  it('captures after approval and exposes the real capture id', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_b', productId: 'beta_mouse' }, ORIGIN)
    approve(r.orderId)
    const done = await captureCheckout(client, A, r.orderId)
    expect(done.status).toBe('COMPLETED'); expect(done.captureId).toBe(`CAP${r.orderId}`)
    expect(store.eventsFor(A).map(e => e.type)).toContain('PAYPAL_CAPTURE_COMPLETED')
  })
  it('sequential duplicate capture hits PayPal only once', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_c', productId: 'gamma_lamp' }, ORIGIN)
    approve(r.orderId)
    await captureCheckout(client, A, r.orderId)
    const again = await captureCheckout(client, A, r.orderId)
    expect(again.status).toBe('COMPLETED'); expect(countCalls('/capture')).toBe(1)
  })
  it('concurrent duplicate capture: exactly one PayPal capture call', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_c', productId: 'gamma_lamp' }, ORIGIN)
    approve(r.orderId)
    const results = await Promise.allSettled([captureCheckout(client, A, r.orderId), captureCheckout(client, A, r.orderId), captureCheckout(client, A, r.orderId)])
    expect(countCalls('/capture')).toBe(1)
    expect(results.filter(x => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1)
    const rejected = results.filter(x => x.status === 'rejected') as PromiseRejectedResult[]
    for (const x of rejected) expect(x.reason).toMatchObject({ code: 'CAPTURE_IN_PROGRESS' })
  })
  it("another browser session cannot see or capture someone else's order", async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_charger' }, ORIGIN)
    approve(r.orderId)
    await expect(captureCheckout(client, B, r.orderId)).rejects.toMatchObject({ code: 'NOT_FOUND', httpStatus: 404 })
    await expect(refreshCheckout(client, B, r.orderId)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(countCalls('/capture')).toBe(0)
  })
  it('blocks capture if PayPal-side amount differs from the request', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_charger' }, ORIGIN)
    approve(r.orderId); fake.orders.get(r.orderId)!.value = '0.01'
    await expect(captureCheckout(client, A, r.orderId)).rejects.toMatchObject({ code: 'AMOUNT_MISMATCH' })
    expect(countCalls('/capture')).toBe(0)
  })
  it('cannot capture a cancelled checkout', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_charger' }, ORIGIN)
    cancelCheckout(A, r.orderId); approve(r.orderId)
    await expect(captureCheckout(client, A, r.orderId)).rejects.toMatchObject({ code: 'CANCELLED' })
  })
  it('refresh moves CREATED -> APPROVED from PayPal truth', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_charger' }, ORIGIN)
    approve(r.orderId)
    expect((await refreshCheckout(client, A, r.orderId)).status).toBe('APPROVED')
  })
})

describe('refund', () => {
  it('refunds a completed capture once; repeat is idempotent', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_headphones' }, ORIGIN)
    approve(r.orderId); await captureCheckout(client, A, r.orderId)
    const a = await refundCheckout(client, A, r.orderId)
    const b = await refundCheckout(client, A, r.orderId)
    expect(a.status).toBe('REFUNDED'); expect(b.refundId).toBe('REF1'); expect(countCalls('/refund')).toBe(1)
  })
  it('refuses to refund an uncaptured order', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_headphones' }, ORIGIN)
    await expect(refundCheckout(client, A, r.orderId)).rejects.toMatchObject({ code: 'BAD_STATE' })
  })
})

describe('safe errors', () => {
  it('OAuth 401 gives a helpful message and leaks no secret', async () => {
    const bad = new PayPalSandboxClient({ clientId: 'id', clientSecret: 'super-secret' }, async () => new Response('{"error":"invalid_client"}', { status: 401 }))
    const err = await createCheckout(bad, A, { merchantId: 'merchant_a', productId: 'alpha_charger' }, ORIGIN).catch(e => e)
    const http = toHttpError(err)
    expect(JSON.stringify(http)).not.toContain('super-secret')
    expect(http.body.code).toBe('OAUTH_FAILED')
  })
  it('PayPal 422 surfaces only the issue code, not the raw body', async () => {
    const r = await createCheckout(client, A, { merchantId: 'merchant_a', productId: 'alpha_charger' }, ORIGIN)
    const err = await client.captureOrder(r.orderId, 'x').catch(e => e)
    const http = toHttpError(err)
    expect(http.body.code).toBe('ORDER_NOT_APPROVED'); expect(JSON.stringify(http)).not.toContain('XYZ'); expect(http.body.debugId).toBe('dbg123')
  })
})

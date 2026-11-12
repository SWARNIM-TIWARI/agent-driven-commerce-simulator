// src/payments/paypal/client.ts
// Minimal PayPal Orders v2 client. SANDBOX ONLY: the base URL is hard-coded,
// so a live credential can never be used by accident. Server-side only.

export const PAYPAL_SANDBOX_BASE = 'https://api-m.sandbox.paypal.com'

export interface PayPalCredentials {
  clientId: string
  clientSecret: string
}

/** Safe error: never contains credentials, tokens or raw upstream bodies. */
export class PayPalError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly code: string,
    readonly debugId?: string,
  ) {
    super(message)
    this.name = 'PayPalError'
  }
}

export interface MoneyAmount {
  currency_code: string
  value: string
}

export interface PayPalOrder {
  id: string
  status: string // CREATED | SAVED | APPROVED | VOIDED | COMPLETED | PAYER_ACTION_REQUIRED
  approveUrl: string | null
  amount: MoneyAmount | null
  customId: string | null
  captureId: string | null
  captureStatus: string | null
  captureAmount: MoneyAmount | null
}

export interface PayPalRefund {
  id: string
  status: string
  amount: MoneyAmount | null
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export function readCredentials(env: Record<string, string | undefined> = process.env): PayPalCredentials | null {
  const clientId = env.PAYPAL_CLIENT_ID?.trim()
  const clientSecret = env.PAYPAL_CLIENT_SECRET?.trim()
  const mode = (env.PAYPAL_MODE ?? 'sandbox').trim().toLowerCase()
  if (!clientId || !clientSecret) return null
  if (mode !== 'sandbox') return null // refuse anything but sandbox
  return { clientId, clientSecret }
}

export function formatMinor(minorUnits: number): string {
  if (!Number.isInteger(minorUnits) || minorUnits <= 0) throw new Error('amount must be a positive integer of minor units')
  const whole = Math.floor(minorUnits / 100)
  const cents = String(minorUnits % 100).padStart(2, '0')
  return `${whole}.${cents}`
}

interface RawLink { href?: string; rel?: string }
interface RawCapture { id?: string; status?: string; amount?: MoneyAmount }
interface RawOrder {
  id?: string
  status?: string
  links?: RawLink[]
  purchase_units?: Array<{
    custom_id?: string
    amount?: MoneyAmount
    payments?: { captures?: RawCapture[] }
  }>
}

function toOrder(raw: RawOrder): PayPalOrder {
  const pu = raw.purchase_units?.[0]
  const cap = pu?.payments?.captures?.[0]
  const link = raw.links?.find(l => l.rel === 'payer-action' || l.rel === 'approve')
  if (!raw.id || !raw.status) throw new PayPalError('Unexpected PayPal response shape', 502, 'BAD_UPSTREAM_SHAPE')
  return {
    id: raw.id,
    status: raw.status,
    approveUrl: link?.href ?? null,
    amount: pu?.amount ?? null,
    customId: pu?.custom_id ?? null,
    captureId: cap?.id ?? null,
    captureStatus: cap?.status ?? null,
    captureAmount: cap?.amount ?? null,
  }
}

export class PayPalSandboxClient {
  private token: { value: string; expiresAt: number } | null = null

  private readonly fetchImpl: FetchLike

  constructor(
    private readonly creds: PayPalCredentials,
    rawFetch: FetchLike = (u, i) => fetch(u, i),
    private readonly now: () => number = () => Date.now(),
  ) {
    // Network-level failures become a safe, specific error instead of an opaque 500.
    this.fetchImpl = async (u, i) => {
      try { return await rawFetch(u, i) }
      catch { throw new PayPalError('Could not reach api-m.sandbox.paypal.com (network/DNS/firewall problem on the server)', 502, 'NETWORK_ERROR') }
    }
  }

  /** Real OAuth call. Returns only non-secret metadata. */
  async probe(): Promise<{ ok: true }> {
    this.token = null
    await this.getToken()
    return { ok: true }
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt - 30_000 > this.now()) return this.token.value
    const basic = Buffer.from(`${this.creds.clientId}:${this.creds.clientSecret}`).toString('base64')
    const res = await this.fetchImpl(`${PAYPAL_SANDBOX_BASE}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new PayPalError(
        res.status === 401 ? 'PayPal rejected the Sandbox credentials (check PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET are Sandbox values)' : 'PayPal OAuth failed',
        res.status, 'OAUTH_FAILED', res.headers.get('paypal-debug-id') ?? undefined,
      )
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!body.access_token) throw new PayPalError('PayPal OAuth returned no token', 502, 'OAUTH_NO_TOKEN')
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 300) * 1000 }
    return this.token.value
  }

  private async call(method: 'GET' | 'POST', path: string, opts: { body?: unknown; requestId?: string } = {}): Promise<unknown> {
    const token = await this.getToken()
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    if (opts.requestId) headers['PayPal-Request-Id'] = opts.requestId
    const init: RequestInit = { method, headers, cache: 'no-store' }
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body)
    const res = await this.fetchImpl(`${PAYPAL_SANDBOX_BASE}${path}`, init)
    const debugId = res.headers.get('paypal-debug-id') ?? undefined
    let json: unknown = null
    try { json = await res.json() } catch { /* empty body */ }
    if (!res.ok) {
      const j = (json ?? {}) as { name?: string; message?: string; details?: Array<{ issue?: string }> }
      const issue = j.details?.[0]?.issue ?? j.name ?? 'PAYPAL_ERROR'
      throw new PayPalError(`PayPal ${method} ${path.split('/').slice(0, 4).join('/')} failed: ${issue}`, res.status, issue, debugId)
    }
    return json
  }

  async createOrder(p: {
    amountMinor: number
    currency: string
    description: string
    referenceId: string
    customId: string
    requestId: string
    returnUrl: string
    cancelUrl: string
  }): Promise<PayPalOrder> {
    const raw = await this.call('POST', '/v2/checkout/orders', {
      requestId: p.requestId,
      body: {
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id: p.referenceId,
          custom_id: p.customId,
          description: p.description.slice(0, 127),
          amount: { currency_code: p.currency, value: formatMinor(p.amountMinor) },
        }],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: 'Commerce Wind Tunnel (Sandbox)',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: p.returnUrl,
              cancel_url: p.cancelUrl,
            },
          },
        },
      },
    })
    return toOrder(raw as RawOrder)
  }

  async getOrder(orderId: string): Promise<PayPalOrder> {
    return toOrder((await this.call('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`)) as RawOrder)
  }

  async captureOrder(orderId: string, requestId: string): Promise<PayPalOrder> {
    return toOrder((await this.call('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { requestId, body: {} })) as RawOrder)
  }

  async refundCapture(captureId: string, p: { requestId: string; amount?: MoneyAmount; note?: string }): Promise<PayPalRefund> {
    const raw = (await this.call('POST', `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
      requestId: p.requestId,
      body: { ...(p.amount ? { amount: p.amount } : {}), ...(p.note ? { note_to_payer: p.note.slice(0, 255) } : {}) },
    })) as { id?: string; status?: string; amount?: MoneyAmount }
    if (!raw.id || !raw.status) throw new PayPalError('Unexpected PayPal refund response', 502, 'BAD_UPSTREAM_SHAPE')
    return { id: raw.id, status: raw.status, amount: raw.amount ?? null }
  }
}

let singleton: PayPalSandboxClient | null | undefined
export function getPayPalClient(): PayPalSandboxClient | null {
  if (singleton !== undefined) return singleton
  const creds = readCredentials()
  singleton = creds ? new PayPalSandboxClient(creds) : null
  return singleton
}

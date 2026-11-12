'use client'
// PAYPAL SANDBOX PROOF — a REAL Sandbox checkout, separate from the simulated agents.
import { useCallback, useEffect, useRef, useState } from 'react'

interface Product { merchantId: string; merchantName: string; productId: string; name: string; amountMinor: number; currency: string }
export interface Checkout {
  orderId: string; merchantId: string; productId: string; productName: string
  amountMinor: number; currency: string
  status: 'CREATED' | 'APPROVED' | 'CAPTURING' | 'COMPLETED' | 'PENDING' | 'CANCELLED' | 'REFUNDING' | 'REFUNDED' | 'FAILED'
  approveUrl: string | null; captureId: string | null; refundId: string | null; lastError: string | null
}
interface ApiErr { error?: string | undefined; code?: string | undefined; debugId?: string | undefined }

const money = (minor: number, cur: string) => `${(minor / 100).toFixed(2)} ${cur}`
const STEPS = ['Order created', 'Buyer approved', 'Captured', 'Refunded'] as const
function stepIndex(s: Checkout['status'] | null): number {
  if (!s) return -1
  if (s === 'CREATED') return 0
  if (s === 'APPROVED' || s === 'CAPTURING') return 1
  if (s === 'COMPLETED' || s === 'PENDING') return 2
  if (s === 'REFUNDED' || s === 'REFUNDING') return 3
  return 0
}

export function PayPalProof({ onChange }: { onChange: () => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [oauth, setOauth] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<Product[]>([])
  const [merchantId, setMerchantId] = useState('merchant_a')
  const [productId, setProductId] = useState('')
  const [checkout, setCheckout] = useState<Checkout | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<ApiErr | null>(null)
  const popup = useRef<Window | null>(null)

  useEffect(() => {
    fetch('/api/paypal/status').then(r => r.json()).then((j: { configured: boolean }) => setConfigured(j.configured)).catch(() => setConfigured(false))
    fetch('/api/paypal/catalog').then(r => r.json()).then((c: Product[]) => { setCatalog(c); setProductId(c.find(p => p.merchantId === 'merchant_a')?.productId ?? '') }).catch(() => undefined)
  }, [])

  const merchants = Array.from(new Map(catalog.map(p => [p.merchantId, p.merchantName])).entries())
  const products = catalog.filter(p => p.merchantId === merchantId)
  const selected = products.find(p => p.productId === productId) ?? products[0]

  const api = useCallback(async (path: string, method = 'POST', body?: unknown): Promise<Checkout | null> => {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const json = (await res.json().catch(() => ({}))) as Checkout & ApiErr
    if (!res.ok) { setError({ error: json.error ?? `HTTP ${res.status}`, code: json.code, debugId: json.debugId }); return null }
    return json
  }, [])

  // Poll PayPal-backed status while a checkout is in flight.
  useEffect(() => {
    if (!checkout || !['CREATED', 'APPROVED'].includes(checkout.status)) return
    const id = window.setInterval(async () => {
      const next = await api(`/api/paypal/orders/${checkout.orderId}`, 'GET')
      if (next) { setCheckout(next); if (next.status !== checkout.status) onChange() }
    }, 2500)
    return () => window.clearInterval(id)
  }, [checkout, api, onChange])

  // The popup return page tells us it finished.
  useEffect(() => {
    const h = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'wt-paypal' || !checkout) return
      void api(`/api/paypal/orders/${checkout.orderId}`, 'GET').then(n => { if (n) { setCheckout(n); onChange() } })
    }
    window.addEventListener('message', h)
    return () => window.removeEventListener('message', h)
  }, [checkout, api, onChange])

  const start = async () => {
    if (!selected) return
    setError(null); setBusy('create')
    popup.current = window.open('', 'paypal_sandbox', 'width=480,height=720') // opened on click so it is not blocked
    const created = await api('/api/paypal/orders', 'POST', { merchantId: selected.merchantId, productId: selected.productId })
    setBusy(null)
    if (!created || !created.approveUrl) { popup.current?.close(); return }
    setCheckout(created); onChange()
    if (popup.current) popup.current.location.href = created.approveUrl
    else window.location.assign(created.approveUrl)
  }
  const act = async (label: string, path: string) => {
    if (!checkout) return
    setError(null); setBusy(label)
    const next = await api(path)
    setBusy(null)
    if (next) { setCheckout(next); onChange() }
  }
  const probe = async () => {
    setBusy('probe'); setOauth(null)
    const r = await fetch('/api/paypal/status?probe=1'); const j = (await r.json()) as { oauth?: string; error?: string }
    setOauth(j.oauth === 'ok' ? 'OAuth OK — real Sandbox token obtained' : `OAuth failed: ${j.error ?? 'unknown'}`); setBusy(null)
  }

  const si = stepIndex(checkout?.status ?? null)
  const st = checkout?.status
  return (
    <div className="pp">
      <div className="pp-head">
        <div>
          <span className="badge badge-sbx">PAYPAL SANDBOX · TEST MONEY ONLY</span>
          <h3 className="pp-title">Real checkout, human-approved</h3>
          <p className="muted pp-lede">The five agents above are simulated. This panel calls the real PayPal Sandbox Orders API from the server — you approve the payment as a Sandbox buyer, then we capture it and show PayPal’s own IDs.</p>
        </div>
        <button className="btn btn-ghost" onClick={probe} disabled={busy === 'probe' || configured === false}>{busy === 'probe' ? 'Checking…' : 'Verify credentials'}</button>
      </div>
      {oauth && <p className="pp-note" role="status">{oauth}</p>}

      {configured === false && (
        <div className="callout" role="alert">
          <b>Sandbox credentials not found on the server.</b> Add these to <code>.env.local</code> and restart <code>npm run dev</code>:
          <pre>{`PAYPAL_MODE=sandbox\nPAYPAL_CLIENT_ID=<Sandbox REST app client id>\nPAYPAL_CLIENT_SECRET=<Sandbox REST app secret>`}</pre>
        </div>
      )}

      <div className="pp-grid">
        <fieldset className="pp-pick" disabled={configured === false || !!busy}>
          <legend>1 · Choose from the experiment</legend>
          <div className="seg" role="radiogroup" aria-label="Merchant">
            {merchants.map(([id, name]) => (
              <button key={id} role="radio" aria-checked={merchantId === id} className={merchantId === id ? 'seg-on' : ''}
                onClick={() => { setMerchantId(id); setProductId(catalog.find(p => p.merchantId === id)?.productId ?? '') }}>{name}</button>
            ))}
          </div>
          <div className="prods" role="radiogroup" aria-label="Product">
            {products.map(p => (
              <button key={p.productId} role="radio" aria-checked={selected?.productId === p.productId} className={`prod ${selected?.productId === p.productId ? 'prod-on' : ''}`} onClick={() => setProductId(p.productId)}>
                <span>{p.name}</span><b>{money(p.amountMinor, p.currency)}</b>
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={start} disabled={!selected || busy === 'create' || (!!checkout && ['CREATED', 'APPROVED', 'CAPTURING'].includes(checkout.status))}>
            {busy === 'create' ? 'Creating Sandbox order…' : `Pay ${selected ? money(selected.amountMinor, selected.currency) : ''} with PayPal Sandbox`}
          </button>
          <p className="fine">Opens PayPal’s Sandbox approval window. Log in with a Sandbox <em>personal (buyer)</em> account — never a real one.</p>
        </fieldset>

        <div className="pp-proof" aria-live="polite">
          <div className="steps" aria-label="Checkout progress">
            {STEPS.map((s, i) => <span key={s} className={i <= si ? 'step step-on' : 'step'}>{i + 1}. {s}</span>)}
          </div>
          {!checkout && <p className="muted">No Sandbox checkout yet. PayPal’s real order and capture IDs will appear here.</p>}
          {checkout && (
            <dl className="ids">
              <dt>Item</dt><dd>{checkout.productName} · {money(checkout.amountMinor, checkout.currency)}</dd>
              <dt>PayPal order ID</dt><dd className="mono">{checkout.orderId}</dd>
              <dt>Status</dt><dd><span className={`pill pill-${checkout.status.toLowerCase()}`}>{checkout.status}</span></dd>
              <dt>PayPal capture ID</dt><dd className="mono">{checkout.captureId ?? '— (captured only after you approve)'}</dd>
              {checkout.refundId && <><dt>PayPal refund ID</dt><dd className="mono">{checkout.refundId}</dd></>}
            </dl>
          )}
          {checkout && (
            <div className="row">
              {st === 'APPROVED' && <button className="btn btn-primary" onClick={() => act('capture', `/api/paypal/orders/${checkout.orderId}/capture`)} disabled={!!busy}>{busy === 'capture' ? 'Capturing…' : 'Capture approved payment'}</button>}
              {st === 'COMPLETED' && <button className="btn btn-ghost" onClick={() => act('refund', `/api/paypal/orders/${checkout.orderId}/refund`)} disabled={!!busy}>{busy === 'refund' ? 'Refunding…' : 'Refund (Sandbox)'}</button>}
              {(st === 'CREATED' || st === 'APPROVED') && <button className="btn btn-ghost" onClick={() => act('cancel', `/api/paypal/orders/${checkout.orderId}/cancel`)} disabled={!!busy}>Cancel checkout</button>}
              {st === 'CREATED' && checkout.approveUrl && <a className="btn btn-ghost" href={checkout.approveUrl} target="_blank" rel="noreferrer">Reopen PayPal approval ↗</a>}
            </div>
          )}
          {st === 'CANCELLED' && <p className="muted" role="status">Checkout cancelled. Nothing was charged.</p>}
          {error && <p className="err" role="alert">{error.error}{error.code ? ` (${error.code})` : ''}{error.debugId ? ` · PayPal debug id ${error.debugId}` : ''}</p>}
        </div>
      </div>
    </div>
  )
}

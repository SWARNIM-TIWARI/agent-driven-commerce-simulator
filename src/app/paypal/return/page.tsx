'use client'
// PayPal sends the buyer back here after approval (?token=<orderId>) or cancellation (?cancelled=1&token=<orderId>).
// Capture only happens after PayPal returns the buyer here AND the server re-confirms status APPROVED with PayPal.
import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function Return() {
  const sp = useSearchParams()
  const token = sp.get('token')
  const cancelled = sp.get('cancelled') === '1'
  const [msg, setMsg] = useState('Finishing your Sandbox checkout…')
  const [ok, setOk] = useState<boolean | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const notify = () => { try { window.opener?.postMessage({ type: 'wt-paypal', orderId: token }, window.location.origin) } catch { /* no opener */ } }
    if (!token) { setOk(false); setMsg('No PayPal order token in the URL.'); return }
    const path = `/api/paypal/orders/${encodeURIComponent(token)}/${cancelled ? 'cancel' : 'capture'}`
    fetch(path, { method: 'POST' })
      .then(async r => {
        const j = (await r.json().catch(() => ({}))) as { status?: string; captureId?: string; error?: string }
        if (!r.ok) { setOk(false); setMsg(j.error ?? 'Something went wrong.') }
        else if (cancelled) { setOk(false); setMsg('Checkout cancelled. Nothing was charged.') }
        else { setOk(true); setMsg(`Sandbox payment ${j.status?.toLowerCase() ?? 'done'}${j.captureId ? ` · capture ${j.captureId}` : ''}.`) }
        notify()
        if (r.ok) setTimeout(() => window.close(), 1800)
      })
      .catch(() => { setOk(false); setMsg('Network error.') })
  }, [token, cancelled])

  return (
    <main className="ret">
      <span className="badge badge-sbx">PAYPAL SANDBOX</span>
      <h1 className="ret-h">{ok === null ? 'One moment' : ok ? 'Payment captured' : 'Not completed'}</h1>
      <p role="status">{msg}</p>
      <p className="muted">You can close this window and return to the Wind Tunnel.</p>
    </main>
  )
}

export default function ReturnPage() {
  return <Suspense fallback={<main className="ret"><p>Loading…</p></main>}><Return /></Suspense>
}

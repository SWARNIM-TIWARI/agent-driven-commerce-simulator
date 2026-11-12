// src/payments/paypal/http.ts — shared route helpers
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getPayPalClient, type PayPalSandboxClient } from './client'
import { toHttpError } from './service'

export const OWNER_COOKIE = 'wt_sbx'

export function ownerOf(req: NextRequest): { id: string; isNew: boolean } {
  const existing = req.cookies.get(OWNER_COOKIE)?.value
  if (existing && /^[a-f0-9-]{36}$/.test(existing)) return { id: existing, isNew: false }
  return { id: randomUUID(), isNew: true }
}

export function withOwnerCookie(res: NextResponse, owner: { id: string; isNew: boolean }) {
  if (owner.isNew) {
    res.cookies.set(OWNER_COOKIE, owner.id, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 })
  }
  return res
}

export function originOf(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? req.nextUrl.host
  const proto = req.headers.get('x-forwarded-proto') ?? req.nextUrl.protocol.replace(':', '')
  return `${proto === 'http' || proto === 'https' ? proto : 'https'}://${host}`
}

export function clientOrError(): { client: PayPalSandboxClient } | { response: NextResponse } {
  const client = getPayPalClient()
  if (!client) {
    return {
      response: NextResponse.json(
        { error: 'PayPal Sandbox is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET (Sandbox values) in .env.local and restart.', code: 'NOT_CONFIGURED' },
        { status: 503 },
      ),
    }
  }
  return { client }
}

export async function guarded(owner: { id: string; isNew: boolean }, fn: () => Promise<unknown>, okStatus = 200) {
  try {
    const data = await fn()
    return withOwnerCookie(NextResponse.json(data, { status: okStatus }), owner)
  } catch (err) {
    const { status, body } = toHttpError(err)
    return withOwnerCookie(NextResponse.json(body, { status }), owner)
  }
}

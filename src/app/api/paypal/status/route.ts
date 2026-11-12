import { NextRequest, NextResponse } from 'next/server'
import { getPayPalClient, readCredentials } from '../../../../payments/paypal/client'
import { toHttpError } from '../../../../payments/paypal/service'

export const dynamic = 'force-dynamic'

// GET /api/paypal/status           -> is it configured? (no network call)
// GET /api/paypal/status?probe=1   -> performs a REAL Sandbox OAuth request
export async function GET(req: NextRequest) {
  const configured = !!readCredentials()
  const base = { configured, environment: 'sandbox' as const }
  if (!configured || req.nextUrl.searchParams.get('probe') !== '1') return NextResponse.json(base)
  try {
    await getPayPalClient()!.probe()
    return NextResponse.json({ ...base, oauth: 'ok' })
  } catch (err) {
    const { status, body } = toHttpError(err)
    return NextResponse.json({ ...base, oauth: 'failed', ...body }, { status })
  }
}

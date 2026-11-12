import { NextRequest, NextResponse } from 'next/server'
import { store } from '../../../../payments/paypal/store'
import { ownerOf } from '../../../../payments/paypal/http'

export const dynamic = 'force-dynamic'

export function GET(req: NextRequest) {
  const owner = ownerOf(req)
  return NextResponse.json({
    source: 'paypal_sandbox_real',
    events: store.eventsFor(owner.id),
  })
}

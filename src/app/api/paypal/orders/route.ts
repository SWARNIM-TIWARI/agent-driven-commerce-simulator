import { NextRequest } from 'next/server'
import { clientOrError, guarded, originOf, ownerOf } from '../../../../payments/paypal/http'
import { createCheckout } from '../../../../payments/paypal/service'
import { publicView } from '../../../../payments/paypal/store'

export const dynamic = 'force-dynamic'

// POST { merchantId, productId } -> creates a REAL Sandbox order, returns approveUrl
export async function POST(req: NextRequest) {
  const owner = ownerOf(req)
  const c = clientOrError()
  if ('response' in c) return c.response
  const body = (await req.json().catch(() => ({}))) as { merchantId?: unknown; productId?: unknown }
  return guarded(owner, async () => publicView(await createCheckout(c.client, owner.id, body, originOf(req))), 201)
}

import { NextRequest } from 'next/server'
import { clientOrError, guarded, ownerOf } from '../../../../../../payments/paypal/http'
import { captureCheckout } from '../../../../../../payments/paypal/service'
import { publicView } from '../../../../../../payments/paypal/store'

export const dynamic = 'force-dynamic'

// POST -> captures ONLY if PayPal reports the buyer approved. Safe to call twice.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owner = ownerOf(req)
  const c = clientOrError()
  if ('response' in c) return c.response
  const { id } = await ctx.params
  return guarded(owner, async () => publicView(await captureCheckout(c.client, owner.id, id)))
}

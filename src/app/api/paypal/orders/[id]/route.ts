import { NextRequest } from 'next/server'
import { clientOrError, guarded, ownerOf } from '../../../../../payments/paypal/http'
import { refreshCheckout } from '../../../../../payments/paypal/service'
import { publicView } from '../../../../../payments/paypal/store'

export const dynamic = 'force-dynamic'

// GET -> re-reads the order from PayPal and returns our synced record
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owner = ownerOf(req)
  const c = clientOrError()
  if ('response' in c) return c.response
  const { id } = await ctx.params
  return guarded(owner, async () => publicView(await refreshCheckout(c.client, owner.id, id)))
}

import { NextRequest } from 'next/server'
import { guarded, ownerOf } from '../../../../../../payments/paypal/http'
import { cancelCheckout } from '../../../../../../payments/paypal/service'
import { publicView } from '../../../../../../payments/paypal/store'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const owner = ownerOf(req)
  const { id } = await ctx.params
  return guarded(owner, async () => publicView(cancelCheckout(owner.id, id)))
}

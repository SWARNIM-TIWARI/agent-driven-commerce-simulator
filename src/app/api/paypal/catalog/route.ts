import { NextResponse } from 'next/server'
import { CHECKOUT_CATALOG } from '../../../../payments/paypal/catalog'

export function GET() {
  return NextResponse.json(CHECKOUT_CATALOG)
}

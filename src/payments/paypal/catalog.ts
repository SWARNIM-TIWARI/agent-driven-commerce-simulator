// src/payments/paypal/catalog.ts
// Server-side source of truth for what a real Sandbox checkout may charge.
// The browser sends only { merchantId, productId }; price and currency come from here,
// so a tampered client cannot change the amount. Keep ids aligned with the
// Experiment 001 scenario (merchant_a/b/c).

export interface CheckoutProduct {
  merchantId: string
  merchantName: string
  productId: string
  name: string
  amountMinor: number // integer cents
  currency: 'USD'
}

export const CHECKOUT_CATALOG: readonly CheckoutProduct[] = [
  { merchantId: 'merchant_a', merchantName: 'AlphaShop',  productId: 'alpha_headphones', name: 'Studio Headphones', amountMinor: 1299, currency: 'USD' },
  { merchantId: 'merchant_a', merchantName: 'AlphaShop',  productId: 'alpha_charger',    name: 'USB-C Charger',     amountMinor: 599,  currency: 'USD' },
  { merchantId: 'merchant_b', merchantName: 'BetaMart',   productId: 'beta_keyboard',    name: 'Mechanical Keyboard', amountMinor: 1499, currency: 'USD' },
  { merchantId: 'merchant_b', merchantName: 'BetaMart',   productId: 'beta_mouse',       name: 'Wireless Mouse',    amountMinor: 799,  currency: 'USD' },
  { merchantId: 'merchant_c', merchantName: 'GammaStore', productId: 'gamma_lamp',       name: 'Desk Lamp',         amountMinor: 999,  currency: 'USD' },
  { merchantId: 'merchant_c', merchantName: 'GammaStore', productId: 'gamma_webcam',     name: 'HD Webcam',         amountMinor: 1199, currency: 'USD' },
]

export function findProduct(merchantId: string, productId: string): CheckoutProduct | undefined {
  return CHECKOUT_CATALOG.find(p => p.merchantId === merchantId && p.productId === productId)
}

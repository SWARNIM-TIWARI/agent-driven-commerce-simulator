// src/domain/merchant.ts

export type PriceLevel       = 'budget' | 'mid' | 'premium'
export type FulfillmentSpeed = 'slow' | 'standard' | 'fast'
export type ReturnPolicy     = 'none' | 'restrictive' | 'flexible'
export type MerchantStatus   = 'active' | 'degraded' | 'unavailable'

export interface MerchantConfig {
  readonly id:               string
  readonly name:             string
  readonly reliability:      number          // 0–1 base fulfillment success probability
  readonly priceLevel:       PriceLevel
  readonly fulfillmentSpeed: FulfillmentSpeed
  readonly returnPolicy:     ReturnPolicy
}

/** Runtime merchant — extends config with mutable simulation state */
export interface Merchant extends MerchantConfig {
  status:      MerchantStatus
  currentLoad: number                        // orders currently in flight
}

export function merchantFromConfig(c: MerchantConfig): Merchant {
  return { ...c, status: 'active', currentLoad: 0 }
}

export const FULFILLMENT_SPEED_SCORE: Record<FulfillmentSpeed, number> = {
  fast:     1.0,
  standard: 0.5,
  slow:     0.0,
}

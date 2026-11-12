// src/domain/product.ts

import type { Money } from './money'

export interface ProductConfig {
  readonly id:                   string
  readonly merchantId:           string
  readonly name:                 string
  readonly category:             string
  readonly price:                Money
  readonly initialInventoryCount: number
}

/** Runtime product — visible and actual inventory can diverge after injection */
export interface Product extends ProductConfig {
  visibleInventoryCount: number  // what agents observe (may be stale)
  actualInventoryCount:  number  // ground truth used by fulfillment
  isListedAvailable:     boolean // merchant's advertised listing state
}

export function productFromConfig(c: ProductConfig): Product {
  return {
    ...c,
    visibleInventoryCount: c.initialInventoryCount,
    actualInventoryCount:  c.initialInventoryCount,
    isListedAvailable:     true,
  }
}

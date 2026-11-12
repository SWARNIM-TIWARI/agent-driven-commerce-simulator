// src/domain/money.ts

export interface Money {
  readonly currency: string   // ISO 4217 — e.g. "USD"
  readonly minorUnits: number // integer — $89.00 = 8900
}

export function money(minorUnits: number, currency = 'USD'): Money {
  if (!Number.isInteger(minorUnits)) {
    throw new Error(`Money.minorUnits must be an integer, got: ${minorUnits}`)
  }
  return Object.freeze({ currency, minorUnits })
}

/** Human-readable helper: usd(89.00) → { currency:'USD', minorUnits:8900 } */
export function usd(dollars: number): Money {
  return money(Math.round(dollars * 100))
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.minorUnits + b.minorUnits, a.currency)
}

export function subtractMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b)
  return money(a.minorUnits - b.minorUnits, a.currency)
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b)
  if (a.minorUnits < b.minorUnits) return -1
  if (a.minorUnits > b.minorUnits) return  1
  return 0
}

export function formatMoney(m: Money): string {
  return `$${(m.minorUnits / 100).toFixed(2)}`
}

export function moneyGTE(a: Money, b: Money): boolean {
  assertSameCurrency(a, b)
  return a.minorUnits >= b.minorUnits
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`)
  }
}

// src/domain/order.ts

import type { Money } from './money'
import type { AgentPhenotype, FailureCategory } from './agent'

export type OrderStatus =
  | 'pending'
  | 'payment_initiated'
  | 'payment_captured'
  | 'payment_failed'
  | 'fulfillment_checking'   // NEW: payment committed, checking actual inventory
  | 'fulfilled'
  | 'fulfillment_failed'     // inventory was unavailable after payment committed
  | 'refund_initiated'
  | 'refunded'
  | 'cancelled'

export interface Order {
  // ── Identity ─────────────────────────────────────────────
  readonly logicalPurchaseKey: string   // experimentId:seed:agentId:decisionSeq:attempt — stable across runs
  readonly id:                 string   // deterministic hash of logicalPurchaseKey
  readonly runId:              string   // differs between fresh and replay
  readonly paypalOrderId:      string | null  // external PayPal ID, only in sandbox mode

  // ── Commerce ─────────────────────────────────────────────
  readonly agentId:            string
  readonly agentPhenotype:     AgentPhenotype
  readonly merchantId:         string
  readonly productId:          string
  readonly quantity:           number
  readonly unitPrice:          Money
  readonly totalAmount:        Money
  readonly currency:           string

  // ── Status ───────────────────────────────────────────────
  status:                      OrderStatus
  failureReason:               string | null
  failureCategory:             FailureCategory | null

  // ── Timing ───────────────────────────────────────────────
  readonly createdAtTick:      number
  updatedAtTick:               number
}

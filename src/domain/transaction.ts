// src/domain/transaction.ts

import type { Money } from './money'

export type TransactionStatus = 'initiated' | 'captured' | 'failed' | 'refunded'

export interface Transaction {
  readonly id:                          string
  readonly runId:                       string
  readonly orderId:                     string
  readonly agentId:                     string
  readonly merchantId:                  string
  readonly amount:                      Money
  readonly status:                      TransactionStatus
  readonly paypalCaptureId:             string | null  // PayPal capture ID, sandbox only
  readonly failureReason:               string | null
  readonly createdAtTick:               number
  readonly updatedAtTick:               number
}

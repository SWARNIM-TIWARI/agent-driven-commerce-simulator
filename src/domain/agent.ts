// src/domain/agent.ts

import type { Money } from './money'
import type { PriceLevel, FulfillmentSpeed, ReturnPolicy } from './merchant'

// ── Phenotype ─────────────────────────────────────────────────

export type AgentPhenotype =
  | 'budget_hunter'
  | 'reliability_first'
  | 'impatient'
  | 'loyal'
  | 'balanced'

// ── Status ────────────────────────────────────────────────────

export type AgentStatus =
  | 'idle'         // hasn't started, or reset after a success (buying next item)
  | 'transacting'  // has selected product, will attempt purchase this tick
  | 'recovering'   // last purchase failed, deciding next move
  | 'completed'    // all objectives fulfilled
  | 'abandoned'    // gave up

// ── Policy ────────────────────────────────────────────────────

export interface AgentPolicy {
  readonly priceSensitivity:    number   // 0–1
  readonly reliabilityWeight:   number   // 0–1
  readonly shippingSpeedWeight: number   // 0–1
  readonly merchantLoyalty:     number   // 0–1 bonus for first successful merchant
  readonly retryTolerance:      number   // max retries before switching
  readonly patience:            number   // max total failures before abandoning
  readonly riskTolerance:       number   // 0–1 (low = flees on first bad signal)
  readonly maxBudget:           Money
  readonly preferredCategories: readonly string[]
}

export interface AgentObjective {
  readonly description:             string
  readonly targetCategory:          string  // '' = no preference
  readonly maxPrice:                Money
  readonly minReliabilityThreshold: number  // 0–1
  readonly quantity:                number  // how many items to purchase total
}

// ── History records ───────────────────────────────────────────

export interface FailureRecord {
  readonly tick:            number
  readonly merchantId:      string
  readonly productId:       string
  readonly reason:          string
  readonly failureCategory: FailureCategory
}

export interface PurchaseRecord {
  readonly tick:       number
  readonly orderId:    string
  readonly merchantId: string
  readonly productId:  string
  readonly price:      Money
}

export type FailureCategory =
  | 'inventory_unavailable'
  | 'payment_failed'
  | 'fulfillment_failed'
  | 'merchant_error'
  | 'timeout'

// ── Payment summary (stored in agent state, no import from order.ts) ──

export interface PaymentSummary {
  readonly success:          boolean
  readonly orderId:          string
  readonly amount:           Money | null
  readonly error:            string | null
  readonly failureCategory:  FailureCategory | null
  readonly tick:             number
}

// ── Runtime state ─────────────────────────────────────────────

export interface AgentState {
  status:                 AgentStatus
  currentMerchantId:      string | null
  currentProductId:       string | null
  retryCount:             number          // retries on current merchant (resets on switch)
  totalFailures:          number          // cumulative failures across all merchants
  merchantSwitchCount:    number
  decisionSequenceNumber: number          // increments each time decide() is called
  recentFailures:         FailureRecord[] // rolling window, max 5
  successfulPurchases:    PurchaseRecord[]
  preferredMerchantId:    string | null   // set after first success; used by loyal
  lastDecisionTick:       number
  lastDecisionAction:     string | null
  lastPaymentSummary:     PaymentSummary | null
}

// ── Config + runtime agent ────────────────────────────────────

export interface AgentConfig {
  readonly id:        string
  readonly name:      string
  readonly phenotype: AgentPhenotype
  readonly policy:    AgentPolicy
  readonly objective: AgentObjective
}

export interface Agent extends AgentConfig {
  state: AgentState
}

export function agentFromConfig(c: AgentConfig): Agent {
  return {
    ...c,
    state: {
      status:                 'idle',
      currentMerchantId:      null,
      currentProductId:       null,
      retryCount:             0,
      totalFailures:          0,
      merchantSwitchCount:    0,
      decisionSequenceNumber: 0,
      recentFailures:         [],
      successfulPurchases:    [],
      preferredMerchantId:    null,
      lastDecisionTick:       0,
      lastDecisionAction:     null,
      lastPaymentSummary:     null,
    },
  }
}

// ── Observations (strict information boundary) ────────────────

export interface ProductObservation {
  readonly productId:             string
  readonly name:                  string
  readonly category:              string
  readonly price:                 Money
  readonly visibleInventoryCount: number  // may be stale — NEVER actualInventoryCount
  readonly isListedAvailable:     boolean
}

export interface MerchantObservation {
  readonly merchantId:          string
  readonly name:                string
  readonly priceLevel:          PriceLevel
  readonly fulfillmentSpeed:    FulfillmentSpeed
  readonly returnPolicy:        ReturnPolicy
  readonly products:            readonly ProductObservation[]
  readonly perceivedReliability: number | null // null = no personal history
  readonly perceivedSampleSize:  number         // how many recent outcomes the belief is based on
}

export interface AgentObservation {
  readonly agentId:                string
  readonly tick:                   number
  readonly currentState:           Readonly<AgentState>
  readonly availableMerchants:     readonly MerchantObservation[]
  readonly ownRecentFailures:      readonly FailureRecord[]
  readonly ownSuccessfulPurchases: readonly PurchaseRecord[]
  readonly lastPaymentSummary:     PaymentSummary | null
  readonly objective:              AgentObjective
}

// ── Actions ───────────────────────────────────────────────────

export type SwitchReason =
  | 'repeated_failures'
  | 'reliability_below_threshold'
  | 'inventory_unavailable'
  | 'price_better_elsewhere'

export type AbandonReason =
  | 'patience_exhausted'
  | 'budget_exceeded'
  | 'all_merchants_failed'
  | 'objective_unreachable'

export type AgentAction =
  | { readonly type: 'SELECT_PRODUCT';     readonly productId: string; readonly merchantId: string }
  | { readonly type: 'INITIATE_PURCHASE';  readonly productId: string; readonly merchantId: string }
  | { readonly type: 'RETRY';              readonly productId: string; readonly merchantId: string; readonly attemptNumber: number }
  | { readonly type: 'SWITCH_MERCHANT';    readonly fromMerchantId: string; readonly toMerchantId: string; readonly reason: SwitchReason }
  | { readonly type: 'ABANDON';            readonly reason: AbandonReason }
  | { readonly type: 'IDLE' }

// ── Decision ──────────────────────────────────────────────────

export interface AgentDecision {
  readonly id:                   string
  readonly agentId:              string
  readonly tick:                 number
  readonly sequenceIndex:        number   // this agent's Nth decision overall
  readonly action:               AgentAction
  readonly rationale:            string | null   // LLM only
  readonly confidence:           number | null   // LLM only
  readonly modelType:            'heuristic' | 'llm' | 'recorded'
  readonly observationSnapshot:  AgentObservation
}

// src/events/types.ts

import type {
  AgentPhenotype, AgentAction, AgentStatus,
  SwitchReason, AbandonReason, FailureCategory,
} from '../domain/agent'
import type { InjectionType, RunMode, PaypalMode } from '../domain/experiment'
import type { Money } from '../domain/money'

// ── Type catalogue ────────────────────────────────────────────

export type EventType =
  | 'RUN_STARTED'           | 'RUN_COMPLETED'         | 'RUN_FAILED'
  | 'TICK_COMPLETED'
  | 'INJECTION_APPLIED'
  | 'AGENT_STATUS_CHANGED'  | 'AGENT_DECISION_MADE'
  | 'AGENT_COMPLETED'       | 'AGENT_ABANDONED'
  | 'PRODUCT_SEARCH_EXECUTED'
  | 'MERCHANT_SELECTED'     | 'PRODUCT_SELECTED'
  | 'ORDER_CREATED'         | 'ORDER_FAILED'
  | 'ORDER_FULFILLED'       | 'ORDER_FULFILLMENT_FAILED'
  | 'MERCHANT_SWITCH_INITIATED'
  | 'RETRY_INITIATED'
  | 'PAYMENT_INITIATED'     | 'PAYMENT_CAPTURED'       | 'PAYMENT_FAILED'
  | 'REFUND_INITIATED'      | 'REFUND_COMPLETED'
  | 'PAYPAL_WEBHOOK_RECEIVED' | 'PAYPAL_WEBHOOK_PROCESSED'
  | 'INVENTORY_DEPLETED'    | 'INVENTORY_STALE_CREATED'
  | 'MERCHANT_STATUS_CHANGED'
  | 'REPLAY_INTEGRITY_WARNING'

// ── Base ──────────────────────────────────────────────────────

export interface BaseEvent<T extends EventType, P extends object> {
  readonly id:            string   // NOT used in replay comparison
  readonly runId:         string   // NOT used in replay comparison
  readonly tick:          number   // used in fingerprint
  readonly wallTime:      number   // NOT used in replay comparison
  readonly type:          T        // used in fingerprint
  readonly payload:       P        // used in fingerprint (canonical subset)
  // Correlation fields — fast filtering
  readonly agentId:       string | null
  readonly merchantId:    string | null
  readonly orderId:       string | null
  readonly transactionId: string | null
}

// ── Typed events ──────────────────────────────────────────────

export type RunStartedEvent = BaseEvent<'RUN_STARTED', {
  readonly experimentId:  string
  readonly seed:          string
  readonly mode:          RunMode
  readonly paypalMode:    PaypalMode
  readonly worldSummary:  { merchantCount: number; productCount: number; agentCount: number; totalTicks: number }
}>

export type RunCompletedEvent = BaseEvent<'RUN_COMPLETED', {
  readonly totalTicks:  number
  readonly durationMs:  number
}>

export type TickCompletedEvent = BaseEvent<'TICK_COMPLETED', {
  readonly tick:                 number
  readonly agentsActed:          number
  readonly injectionsApplied:    string[]
}>

export type InjectionAppliedEvent = BaseEvent<'INJECTION_APPLIED', {
  readonly injectionId:        string
  readonly injectionType:      InjectionType
  readonly targetMerchantId:   string | null
  readonly targetProductId:    string | null
  readonly parametersApplied:  Record<string, unknown>
  // System-only: agents cannot observe this event directly
  readonly systemOnly:         true
}>

export type AgentStatusChangedEvent = BaseEvent<'AGENT_STATUS_CHANGED', {
  readonly phenotype: AgentPhenotype
  readonly from:      AgentStatus
  readonly to:        AgentStatus
}>

export type AgentDecisionMadeEvent = BaseEvent<'AGENT_DECISION_MADE', {
  readonly phenotype:            AgentPhenotype
  readonly action:               AgentAction
  readonly modelType:            'heuristic' | 'llm' | 'recorded'
  readonly confidence:           number | null
  readonly rationale:            string | null
  readonly retryCount:           number
  readonly merchantSwitchCount:  number
  readonly sequenceIndex:        number
}>

export type AgentAbandonedEvent = BaseEvent<'AGENT_ABANDONED', {
  readonly phenotype:           AgentPhenotype
  readonly reason:              AbandonReason
  readonly totalFailures:       number
  readonly merchantSwitchCount: number
}>

export type AgentCompletedEvent = BaseEvent<'AGENT_COMPLETED', {
  readonly phenotype:              AgentPhenotype
  readonly successfulPurchases:    number
  readonly totalFailures:          number
  readonly merchantSwitchCount:    number
  readonly ticksToCompletion:      number
}>

export type ProductSearchExecutedEvent = BaseEvent<'PRODUCT_SEARCH_EXECUTED', {
  readonly phenotype:       AgentPhenotype
  readonly query:           string
  readonly targetCategory:  string
  readonly resultsCount:    number
}>

export type ProductSelectedEvent = BaseEvent<'PRODUCT_SELECTED', {
  readonly phenotype:   AgentPhenotype
  readonly productName: string
  readonly price:       Money
  readonly score:       number
}>

export type OrderCreatedEvent = BaseEvent<'ORDER_CREATED', {
  readonly logicalPurchaseKey: string
  readonly phenotype:          AgentPhenotype
  readonly productId:          string
  readonly amount:             Money
  readonly paypalOrderId:      string | null
}>

export type OrderFailedEvent = BaseEvent<'ORDER_FAILED', {
  readonly phenotype:        AgentPhenotype
  readonly productId:        string
  readonly failureReason:    string
  readonly failureCategory:  FailureCategory
}>

export type OrderFulfillmentFailedEvent = BaseEvent<'ORDER_FULFILLMENT_FAILED', {
  readonly phenotype:     AgentPhenotype
  readonly productId:     string
  readonly reason:        string
  readonly refundIssued:  boolean
}>

export type OrderFulfilledEvent = BaseEvent<'ORDER_FULFILLED', {
  readonly phenotype:  AgentPhenotype
  readonly productId:  string
  readonly amount:     Money
}>

export type MerchantSwitchInitiatedEvent = BaseEvent<'MERCHANT_SWITCH_INITIATED', {
  readonly phenotype:            AgentPhenotype
  readonly fromMerchantId:       string
  readonly toMerchantId:         string
  readonly reason:               SwitchReason
  readonly failureCountAtSource: number
}>

export type RetryInitiatedEvent = BaseEvent<'RETRY_INITIATED', {
  readonly phenotype:     AgentPhenotype
  readonly attemptNumber: number
  readonly productId:     string
}>

export type PaymentInitiatedEvent = BaseEvent<'PAYMENT_INITIATED', {
  readonly amount:       Money
  readonly providerType: 'paypal_sandbox' | 'simulated'
}>

export type PaymentCapturedEvent = BaseEvent<'PAYMENT_CAPTURED', {
  readonly amount:         Money
  readonly providerType:   'paypal_sandbox' | 'simulated'
  readonly paypalCaptureId: string | null
}>

export type PaymentFailedEvent = BaseEvent<'PAYMENT_FAILED', {
  readonly amount:          Money
  readonly failureReason:   string
  readonly providerType:    'paypal_sandbox' | 'simulated'
  readonly paypalErrorCode: string | null
}>

export type InventoryStaleCreatedEvent = BaseEvent<'INVENTORY_STALE_CREATED', {
  readonly affectedProductIds:  string[]
  readonly visibleCount:        number
  readonly actualCount:         number
  readonly systemOnly:          true     // agents cannot directly observe this
}>

export type InventoryDepletedEvent = BaseEvent<'INVENTORY_DEPLETED', {
  readonly productId:   string
  readonly productName: string
}>

export type ReplayIntegrityWarningEvent = BaseEvent<'REPLAY_INTEGRITY_WARNING', {
  readonly agentId:          string
  readonly tick:             number
  readonly sequenceIndex:    number
  readonly expectedInputHash: string
  readonly actualInputHash:   string
}>

// ── Union ─────────────────────────────────────────────────────

export type SimEvent =
  | RunStartedEvent             | RunCompletedEvent
  | TickCompletedEvent          | InjectionAppliedEvent
  | AgentStatusChangedEvent     | AgentDecisionMadeEvent
  | AgentAbandonedEvent         | AgentCompletedEvent
  | ProductSearchExecutedEvent  | ProductSelectedEvent
  | OrderCreatedEvent           | OrderFailedEvent
  | OrderFulfilledEvent         | OrderFulfillmentFailedEvent
  | MerchantSwitchInitiatedEvent | RetryInitiatedEvent
  | PaymentInitiatedEvent       | PaymentCapturedEvent
  | PaymentFailedEvent          | InventoryStaleCreatedEvent
  | InventoryDepletedEvent      | ReplayIntegrityWarningEvent

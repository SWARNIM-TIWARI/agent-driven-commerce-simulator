// src/domain/experiment.ts

import type { AgentConfig } from './agent'
import type { MerchantConfig } from './merchant'
import type { ProductConfig } from './product'

export type InjectionType =
  | 'STALE_INVENTORY'         // Experiment 001
  | 'MERCHANT_PRICE_CHANGE'   // Experiment 002
  | 'MERCHANT_FAILURE'        // Experiment 003
  | 'DEMAND_SURGE'            // Experiment 003

export interface ScenarioInjection {
  readonly id:               string
  readonly atTick:           number
  readonly type:             InjectionType
  readonly targetMerchantId: string | null
  readonly targetProductId:  string | null
  readonly parameters:       Record<string, unknown>
  applied:                   boolean
}

export interface WorldConfig {
  readonly merchants: readonly MerchantConfig[]
  readonly products:  readonly ProductConfig[]
  readonly agents:    readonly AgentConfig[]
}

export interface ScenarioConfig {
  readonly name:        string
  readonly description: string
  readonly totalTicks:  number
  readonly injections:  readonly ScenarioInjection[]
}

export type PaypalMode = 'paypal_sandbox' | 'simulated'
export type RunMode    = 'fresh'   | 'replay'
export type RunStatus  = 'pending' | 'running' | 'completed' | 'failed'

export interface Experiment {
  readonly id:             string
  readonly name:           string
  readonly description:    string
  readonly worldConfig:    WorldConfig
  readonly scenarioConfig: ScenarioConfig
  readonly createdAt:      Date
}

export interface ExperimentRun {
  readonly id:            string
  readonly experimentId:  string
  readonly seed:          string
  readonly mode:          RunMode
  status:                 RunStatus
  readonly paypalMode:    PaypalMode
  readonly sourceRunId:   string | null   // for replay: points to original run
  startedAt:              Date | null
  completedAt:            Date | null
  errorMessage:           string | null
  decisionTrace:          string | null   // serialized RecordedDecisionProvider
  paymentTrace:           string | null   // serialized RecordedPaymentProvider
}

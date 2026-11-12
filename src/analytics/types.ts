// src/analytics/types.ts
import type { AgentPhenotype } from '../domain/agent'

export interface CommerceMetrics {
  totalPurchaseAttempts:   number
  successfulPurchases:     number
  failedPurchases:         number
  abandonments:            number
  refunds:                 number
  paypalOrdersCreated:     number
  paypalCapturesSucceeded: number
  paypalCapturesFailed:    number
  totalRevenue:            number   // minor units
  conversionRate:          number   // 0–1
}

export interface AgentRunMetrics {
  agentId:            string
  phenotype:          AgentPhenotype
  totalDecisions:     number
  retries:            number
  merchantSwitches:   number
  timeToFirstSuccess: number | null
  timeToRecovery:     number | null
  abandoned:          boolean
  finalMerchantId:    string | null
}

export interface PhenotypeMetrics {
  phenotype:           AgentPhenotype
  agentCount:          number
  avgRetries:          number
  avgMerchantSwitches: number
  recoveryRate:        number
  avgTimeToRecovery:   number | null
  abandonmentRate:     number
}

export interface DemandConcentrationMetric {
  preInjectionHerfindahlIndex:  number
  postInjectionHerfindahlIndex: number
  dominantMerchantIdPost:       string
  concentrationIncrease:        number
}

export interface FailureClusterMetric {
  failureStartTick:        number
  failurePeakTick:         number
  failureDurationTicks:    number
  totalFailures:           number
  failuresPerTick:         Record<number, number>
  primaryFailedMerchantId: string
}

export interface MigrationIntensityMetric {
  totalMerchantSwitches: number
  switchesByTick:        Record<number, number>
  fromMerchant:          Record<string, number>
  toMerchant:            Record<string, number>
  migrationStartTick:    number
  migrationPeakTick:     number
}

export interface SystemMetrics {
  demandConcentration:            DemandConcentrationMetric
  merchantLoadByTick:             Record<string, number[]>
  inventoryDepletionByMerchant:   Record<string, number>
  failureCluster:                 FailureClusterMetric
  migrationIntensity:             MigrationIntensityMetric
}

export interface RunMetrics {
  runId:         string
  experimentId:  string
  commerce:      CommerceMetrics
  agentBehavior: {
    byAgent:     Record<string, AgentRunMetrics>
    byPhenotype: Record<AgentPhenotype, PhenotypeMetrics>
  }
  system:        SystemMetrics
  injectionTick: number | null
  generatedAt:   Date
}

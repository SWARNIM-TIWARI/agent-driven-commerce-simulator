// src/domain/finding.ts

import type { AgentPhenotype } from './agent'

// Corrected: no "causal_proof" — analyst may identify patterns, not prove causes
export type FindingType =
  | 'observed_pattern'
  | 'system_effect'
  | 'hypothesis'
  | 'impact'
  | 'intervention'

export type FindingSeverity = 'info' | 'notable' | 'significant' | 'critical'

export interface EvidenceRef {
  readonly description:  string
  readonly eventIds:     string[]
  readonly agentIds?:    string[]
  readonly merchantIds?: string[]
  readonly tickRange?:   [number, number]
  readonly metricName?:  string
  readonly metricValue?: number
  readonly metricUnit?:  string
}

export interface Finding {
  readonly id:                    string
  readonly runId:                 string
  readonly type:                  FindingType
  readonly severity:              FindingSeverity
  readonly title:                 string
  readonly description:           string
  readonly evidence:              readonly EvidenceRef[]
  readonly suggestedIntervention: string | null
  readonly generatedAt:           Date
}

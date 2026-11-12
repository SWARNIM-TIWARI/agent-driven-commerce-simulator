// src/lib/lab.ts — shared UI types, constants and pure helpers (no React).

export interface AgentSummary { agentId: string; phenotype: string; retries: number; merchantSwitches: number; abandoned: boolean; finalMerchantId: string | null }
export interface Finding {
  id: string; type: string; severity: string; title: string; description: string
  suggestedIntervention: string | null
  evidence?: unknown            // returned by /api/runs (array of event ids or objects with eventId)
  confidence?: string | number
}
export interface LabEvent {
  id: string; tick: number; type: string
  agentId: string | null; merchantId: string | null; orderId: string | null
  payload?: Record<string, unknown>
}
export interface RunResult {
  runId: string; status: string; eventCount: number; totalTicks: number
  overallAssessment: string; confidence: string; modelUsed: string
  findings: Finding[]
  seed?: string; withInjection?: boolean; injectionTick?: number | null
  events?: LabEvent[]
  metrics: {
    commerce: { totalPurchaseAttempts: number; successfulPurchases: number; failedPurchases: number; conversionRate: number; abandonments: number }
    system: {
      demandConcentration: { preInjectionHerfindahlIndex: number; postInjectionHerfindahlIndex: number; concentrationIncrease: number; dominantMerchantIdPost: string }
      migrationIntensity: { totalMerchantSwitches: number }
      merchantLoadByTick: Record<string, number[]>
    }
    agentBehavior: { byAgent: Record<string, AgentSummary> }
  }
}

export interface MerchantDef { id: string; name: string; color: string; shape: 'hex' | 'diamond' | 'circle'; x: number; y: number }
export interface AgentDef { id: string; name: string; phenotype: string; color: string; glyph: string; x: number; y: number }

// Stage coordinates live in a 1000 x 600 viewBox.
export const MERCHANTS: MerchantDef[] = [
  { id: 'merchant_a', name: 'AlphaShop',  color: '#38BDF8', shape: 'hex',     x: 740, y: 120 },
  { id: 'merchant_b', name: 'BetaMart',   color: '#A3E635', shape: 'diamond', x: 890, y: 300 },
  { id: 'merchant_c', name: 'GammaStore', color: '#C084FC', shape: 'circle',  x: 740, y: 480 },
]

export const AGENTS: AgentDef[] = [
  { id: 'agent_budget',    name: 'BudgetBot',     phenotype: 'budget_hunter',     color: '#FBBF24', glyph: '$', x: 110, y: 70 },
  { id: 'agent_reliable',  name: 'ReliableRoger', phenotype: 'reliability_first', color: '#22D3EE', glyph: '✓', x: 110, y: 185 },
  { id: 'agent_impatient', name: 'ImpatientIvan', phenotype: 'impatient',         color: '#F87171', glyph: '!', x: 110, y: 300 },
  { id: 'agent_loyal',     name: 'LoyalLisa',     phenotype: 'loyal',             color: '#E879F9', glyph: '♥', x: 110, y: 415 },
  { id: 'agent_balanced',  name: 'BalancedBea',   phenotype: 'balanced',          color: '#4ADE80', glyph: '◎', x: 110, y: 530 },
]

export type EventKind = 'attempt' | 'success' | 'fail' | 'switch' | 'abandon' | 'injection' | 'system' | 'other'

export function kindOf(type: string): EventKind {
  if (/INJECT|STALE|SCENARIO_/.test(type)) return 'injection'
  if (/MERCHANT_SWITCH/.test(type)) return 'switch'
  if (/ABANDON/.test(type)) return 'abandon'
  if (/FAIL/.test(type)) return 'fail'
  if (/ORDER_FULFILLED|AGENT_COMPLETED/.test(type)) return 'success'
  if (/PAYMENT_INITIATED|ORDER_CREATED/.test(type)) return 'attempt'
  if (/RUN_|TICK_/.test(type)) return 'system'
  return 'other'
}

export const KIND_COLOR: Record<EventKind, string> = {
  attempt: '#93C5FD', success: '#34D399', fail: '#F87171', switch: '#FBBF24',
  abandon: '#FB7185', injection: '#FF6B35', system: '#9CA3AF', other: '#9CA3AF',
}

export function sumLoad(load: Record<string, number[]> | undefined, merchantId: string): number {
  return (load?.[merchantId] ?? []).reduce((a, b) => a + b, 0)
}

export interface MerchantTally { attempts: number; fulfilled: number; failed: number }

/** Cumulative per-merchant tallies of REAL recorded events up to and including `tick`. */
export function tallyUpTo(events: LabEvent[], tick: number): Record<string, MerchantTally> {
  const out: Record<string, MerchantTally> = {}
  for (const m of MERCHANTS) out[m.id] = { attempts: 0, fulfilled: 0, failed: 0 }
  for (const e of events) {
    if (e.tick > tick || !e.merchantId || !out[e.merchantId]) continue
    const k = kindOf(e.type)
    if (k === 'attempt') out[e.merchantId]!.attempts++
    else if (k === 'success' && /ORDER_FULFILLED/.test(e.type)) out[e.merchantId]!.fulfilled++
    else if (k === 'fail') out[e.merchantId]!.failed++
  }
  return out
}

/** Last merchant each agent interacted with and its latest behavioural state, as of `tick`. */
export function agentStateAt(events: LabEvent[], tick: number) {
  const st: Record<string, { merchantId: string | null; status: string; fulfilled: number; failures: number; switches: number }> = {}
  for (const a of AGENTS) st[a.id] = { merchantId: null, status: 'idle', fulfilled: 0, failures: 0, switches: 0 }
  for (const e of events) {
    if (e.tick > tick || !e.agentId || !st[e.agentId]) continue
    const s = st[e.agentId]!
    const k = kindOf(e.type)
    if (e.merchantId) s.merchantId = k === 'switch' ? ((e.payload?.toMerchantId as string | undefined) ?? e.merchantId) : e.merchantId
    if (k === 'attempt') s.status = 'transacting'
    else if (k === 'success') { s.status = 'completed'; if (/ORDER_FULFILLED/.test(e.type)) s.fulfilled++ }
    else if (k === 'fail') { s.status = 'recovering'; s.failures++ }
    else if (k === 'switch') { s.status = 'switching'; s.switches++ }
    else if (k === 'abandon') s.status = 'abandoned'
  }
  return st
}

export function evidenceIds(evidence: unknown): string[] {
  if (!Array.isArray(evidence)) return []
  const out: string[] = []
  for (const x of evidence) {
    if (typeof x === 'string') out.push(x)
    else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>
      if (typeof o.eventId === 'string') out.push(o.eventId)
      else if (Array.isArray(o.eventIds)) for (const id of o.eventIds) if (typeof id === 'string') out.push(id)
    }
  }
  return out
}

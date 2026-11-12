// src/analytics/metrics.ts
import type { EventBus } from '../events/bus'
import type { WorldState } from '../simulation/world'
import type {
  AgentRunMetrics, PhenotypeMetrics,
  CommerceMetrics, SystemMetrics,
  DemandConcentrationMetric, FailureClusterMetric, MigrationIntensityMetric,
  RunMetrics,
} from './types'
import type { AgentPhenotype } from '../domain/agent'

export type { RunMetrics }

export function extractMetrics(bus: EventBus, world: WorldState, injectionTick: number | null): RunMetrics {
  const events   = bus.getBuffer()
  const agents   = world.getAgents()

  // ── Commerce ──────────────────────────────────────────────
  const fulfilled  = bus.getByType('ORDER_FULFILLED').length
  const failedOrds = bus.getByType('ORDER_FAILED').length + bus.getByType('ORDER_FULFILLMENT_FAILED').length
  const abandoned  = bus.getByType('AGENT_ABANDONED').length
  const attempts   = fulfilled + failedOrds

  const commerce: CommerceMetrics = {
    totalPurchaseAttempts:   attempts,
    successfulPurchases:     fulfilled,
    failedPurchases:         failedOrds,
    abandonments:            abandoned,
    refunds:                 0,
    paypalOrdersCreated:     bus.getByType('ORDER_CREATED').length,
    paypalCapturesSucceeded: bus.getByType('PAYMENT_CAPTURED').length,
    paypalCapturesFailed:    bus.getByType('PAYMENT_FAILED').length,
    totalRevenue:            bus.getByType('ORDER_FULFILLED')
      .reduce((s, e) => s + (e.payload as { amount: { minorUnits: number } }).amount.minorUnits, 0),
    conversionRate:          attempts > 0 ? fulfilled / attempts : 0,
  }

  // ── Per-agent ─────────────────────────────────────────────
  const agentMetrics: Record<string, AgentRunMetrics> = {}
  for (const agent of agents) {
    const s              = agent.state
    const firstFailTick  = s.recentFailures[0]?.tick ?? null
    const firstSuccTick  = s.successfulPurchases[0]?.tick ?? null
    const recovery       = (firstFailTick && firstSuccTick && firstSuccTick > firstFailTick)
      ? firstSuccTick - firstFailTick : null

    agentMetrics[agent.id] = {
      agentId:            agent.id,
      phenotype:          agent.phenotype,
      totalDecisions:     s.decisionSequenceNumber,
      retries:            s.totalFailures,
      merchantSwitches:   s.merchantSwitchCount,
      timeToFirstSuccess: firstSuccTick,
      timeToRecovery:     recovery,
      abandoned:          s.status === 'abandoned',
      finalMerchantId:    s.currentMerchantId,
    }
  }

  // ── Per-phenotype ─────────────────────────────────────────
  const byPhenotype = new Map<AgentPhenotype, AgentRunMetrics[]>()
  for (const m of Object.values(agentMetrics)) {
    const arr = byPhenotype.get(m.phenotype) ?? []
    arr.push(m)
    byPhenotype.set(m.phenotype, arr)
  }

  const phenotypeMetrics: Record<string, PhenotypeMetrics> = {}
  for (const [pheno, arr] of byPhenotype) {
    const recovered      = arr.filter(a => a.timeToRecovery !== null)
    phenotypeMetrics[pheno] = {
      phenotype:          pheno,
      agentCount:         arr.length,
      avgRetries:         avg(arr.map(a => a.retries)),
      avgMerchantSwitches: avg(arr.map(a => a.merchantSwitches)),
      recoveryRate:       arr.length > 0 ? recovered.length / arr.length : 0,
      avgTimeToRecovery:  recovered.length > 0 ? avg(recovered.map(a => a.timeToRecovery!)) : null,
      abandonmentRate:    arr.length > 0 ? arr.filter(a => a.abandoned).length / arr.length : 0,
    }
  }

  // ── System: demand concentration ─────────────────────────
  const merchants     = world.getMerchants()
  const merchantIds   = merchants.map(m => m.id)
  const injTick       = injectionTick ?? 9999

  const fulfilledEvts = bus.getByType('ORDER_FULFILLED') as Array<{ tick: number; merchantId: string | null }>
  const preDemand     = Object.fromEntries(merchantIds.map(id => [id, 0])) as Record<string, number>
  const postDemand    = Object.fromEntries(merchantIds.map(id => [id, 0])) as Record<string, number>

  for (const e of fulfilledEvts) {
    if (!e.merchantId) continue
    if (e.tick < injTick) preDemand[e.merchantId]  = (preDemand[e.merchantId]  ?? 0) + 1
    else                   postDemand[e.merchantId] = (postDemand[e.merchantId] ?? 0) + 1
  }

  const demandConcentration: DemandConcentrationMetric = {
    preInjectionHerfindahlIndex:  hhi(Object.values(preDemand)),
    postInjectionHerfindahlIndex: hhi(Object.values(postDemand)),
    dominantMerchantIdPost:       Object.entries(postDemand).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
    concentrationIncrease:        hhi(Object.values(postDemand)) - hhi(Object.values(preDemand)),
  }

  // ── System: failure cluster ───────────────────────────────
  const failureEvents = bus.getByType('ORDER_FULFILLMENT_FAILED') as Array<{ tick: number; merchantId: string | null }>
  const failsByTick   = new Map<number, number>()
  for (const e of failureEvents) failsByTick.set(e.tick, (failsByTick.get(e.tick) ?? 0) + 1)
  const peakEntry     = [...failsByTick.entries()].sort((a, b) => b[1] - a[1])[0]

  const failureCluster: FailureClusterMetric = {
    failureStartTick:        failsByTick.size > 0 ? Math.min(...Array.from(failsByTick.keys())) : 0,
    failurePeakTick:         peakEntry?.[0] ?? 0,
    failureDurationTicks:    failsByTick.size,
    totalFailures:           failureEvents.length,
    failuresPerTick:         Object.fromEntries(failsByTick),
    primaryFailedMerchantId: failureEvents[0]?.merchantId ?? '',
  }

  // ── System: migration ─────────────────────────────────────
  const switchEvts = bus.getByType('MERCHANT_SWITCH_INITIATED') as Array<{
    tick: number
    payload: { fromMerchantId: string; toMerchantId: string }
  }>

  const switchesByTick = new Map<number, number>()
  const fromMerchant   = new Map<string, number>()
  const toMerchant     = new Map<string, number>()
  for (const e of switchEvts) {
    switchesByTick.set(e.tick, (switchesByTick.get(e.tick) ?? 0) + 1)
    fromMerchant.set(e.payload.fromMerchantId, (fromMerchant.get(e.payload.fromMerchantId) ?? 0) + 1)
    toMerchant.set(e.payload.toMerchantId, (toMerchant.get(e.payload.toMerchantId) ?? 0) + 1)
  }

  const peakSwitch     = [...switchesByTick.entries()].sort((a, b) => b[1] - a[1])[0]
  const migrationIntensity: MigrationIntensityMetric = {
    totalMerchantSwitches: switchEvts.length,
    switchesByTick:        Object.fromEntries(switchesByTick),
    fromMerchant:          Object.fromEntries(fromMerchant),
    toMerchant:            Object.fromEntries(toMerchant),
    migrationStartTick:    Math.min(...(switchesByTick.size > 0 ? [...switchesByTick.keys()] : [0])),
    migrationPeakTick:     peakSwitch?.[0] ?? 0,
  }

  const merchantLoadByTick: Record<string, number[]> = {}
  const totalTicks = world.tick
  for (const m of merchants) {
    merchantLoadByTick[m.id] = new Array(totalTicks + 1).fill(0)
  }
  for (const e of bus.getByType('ORDER_CREATED') as Array<{ tick: number; merchantId: string | null }>) {
    if (e.merchantId && merchantLoadByTick[e.merchantId]) {
      merchantLoadByTick[e.merchantId]![e.tick] = (merchantLoadByTick[e.merchantId]![e.tick] ?? 0) + 1
    }
  }

  return {
    runId:       world.runId,
    experimentId: world.experimentId,
    commerce,
    agentBehavior: {
      byAgent:     agentMetrics,
      byPhenotype: phenotypeMetrics as Record<AgentPhenotype, PhenotypeMetrics>,
    },
    system: {
      demandConcentration,
      merchantLoadByTick,
      inventoryDepletionByMerchant: Object.fromEntries(
        merchants.map(m => {
          const products = world.getProductsByMerchant(m.id)
          const initial  = products.reduce((s, p) => s + p.initialInventoryCount, 0)
          const actual   = products.reduce((s, p) => s + p.actualInventoryCount, 0)
          return [m.id, initial > 0 ? 1 - actual / initial : 0]
        })
      ),
      failureCluster,
      migrationIntensity,
    },
    injectionTick,
    generatedAt: new Date(),
  }
}

function avg(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function hhi(demands: number[]): number {
  const total = demands.reduce((a, b) => a + b, 0)
  if (total === 0) return 0
  return demands.reduce((s, d) => s + Math.pow(d / total, 2), 0)
}

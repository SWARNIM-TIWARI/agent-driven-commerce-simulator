// src/agents/models/heuristic.ts

import type {
  AgentAction, AgentDecision, AgentObservation, AgentPolicy,
  MerchantObservation, ProductObservation, SwitchReason,
} from '../../domain/agent'
import { FULFILLMENT_SPEED_SCORE } from '../../domain/merchant'
import { nextEventId } from '../../simulation/prng'

/** Outcomes needed before reliability belief can exclude a merchant. */
const MIN_EVIDENCE = 3

interface Candidate { merchant: MerchantObservation; product: ProductObservation }

export class HeuristicAgentModelWithPolicy {
  readonly modelType = 'heuristic' as const

  constructor(private readonly policy: AgentPolicy) {}

  decide(obs: AgentObservation): AgentDecision {
    return {
      id:                  nextEventId(obs.agentId),
      agentId:             obs.agentId,
      tick:                obs.tick,
      sequenceIndex:       obs.currentState.decisionSequenceNumber,
      action:              this.computeAction(obs),
      rationale:           null,
      confidence:          null,
      modelType:           'heuristic',
      observationSnapshot: obs,
    }
  }

  private computeAction(obs: AgentObservation): AgentAction {
    switch (obs.currentState.status) {
      case 'idle':        return this.fromIdle(obs)
      case 'transacting': return this.fromTransacting(obs)
      case 'recovering':  return this.fromRecovering(obs)
      default:            return { type: 'IDLE' }
    }
  }

  // ── IDLE ────────────────────────────────────────────────────
  // currentMerchantId while idle means: we just switched here.
  // Stay on the target merchant — the switch is binding.
  private fromIdle(obs: AgentObservation): AgentAction {
    const target = obs.currentState.currentMerchantId
    let pool: readonly MerchantObservation[] = obs.availableMerchants

    if (target) {
      const restricted = pool.filter(m => m.merchantId === target)
      if (restricted.length > 0) pool = restricted
    }

    let pick = this.best(this.collect(obs, pool, null), obs)

    // If the target merchant has nothing suitable, open up to all merchants
    if (!pick && pool !== obs.availableMerchants) {
      pick = this.best(this.collect(obs, obs.availableMerchants, null), obs)
    }

    if (!pick) return { type: 'ABANDON', reason: 'objective_unreachable' }

    return {
      type:       'SELECT_PRODUCT',
      productId:  pick.product.productId,
      merchantId: pick.merchant.merchantId,
    }
  }

  // ── TRANSACTING ─────────────────────────────────────────────
  private fromTransacting(obs: AgentObservation): AgentAction {
    const s = obs.currentState
    if (!s.currentMerchantId || !s.currentProductId) {
      return { type: 'ABANDON', reason: 'objective_unreachable' }
    }
    return {
      type:       'INITIATE_PURCHASE',
      productId:  s.currentProductId,
      merchantId: s.currentMerchantId,
    }
  }

  // ── RECOVERING ──────────────────────────────────────────────
  // Phenotypes diverge most visibly here:
  //   impatient  retryTolerance=0  → switches on first failure
  //   loyal      retryTolerance=5  → retries five times before switching
  private fromRecovering(obs: AgentObservation): AgentAction {
    const s      = obs.currentState
    const policy = this.policy

    if (s.totalFailures >= policy.patience) {
      return { type: 'ABANDON', reason: 'patience_exhausted' }
    }

    if (s.retryCount < policy.retryTolerance) {
      if (!s.currentProductId || !s.currentMerchantId) {
        return { type: 'ABANDON', reason: 'objective_unreachable' }
      }
      return {
        type:          'RETRY',
        productId:     s.currentProductId,
        merchantId:    s.currentMerchantId,
        attemptNumber: s.retryCount + 1,
      }
    }

    // Retry tolerance exhausted — determine why we're switching
    let reason: SwitchReason = 'repeated_failures'
    if (s.currentMerchantId) {
      const current = obs.availableMerchants.find(m => m.merchantId === s.currentMerchantId)
      const floor   = (1 - policy.riskTolerance) * obs.objective.minReliabilityThreshold
      if (
        current &&
        current.perceivedReliability !== null &&
        current.perceivedReliability < floor
      ) {
        reason = 'reliability_below_threshold'
      }
    }

    return this.switchOrAbandon(obs, reason)
  }

  private switchOrAbandon(obs: AgentObservation, reason: SwitchReason): AgentAction {
    const from = obs.currentState.currentMerchantId
    const pick = this.best(this.collect(obs, obs.availableMerchants, from), obs)
    if (!from || !pick) return { type: 'ABANDON', reason: 'all_merchants_failed' }
    return {
      type:           'SWITCH_MERCHANT',
      fromMerchantId: from,
      toMerchantId:   pick.merchant.merchantId,
      reason,
    }
  }

  // ── Candidate helpers ────────────────────────────────────────

  private collect(
    obs:       AgentObservation,
    merchants: readonly MerchantObservation[],
    excludeId: string | null,
  ): Candidate[] {
    const out: Candidate[] = []
    for (const merchant of merchants) {
      if (merchant.merchantId === excludeId) continue
      if (this.isDistrusted(merchant, obs)) continue
      for (const product of merchant.products) {
        if (product.price.minorUnits <= obs.objective.maxPrice.minorUnits) {
          out.push({ merchant, product })
        }
      }
    }
    return out
  }

  // One bad outcome is noise. Distrust requires MIN_EVIDENCE data points.
  private isDistrusted(m: MerchantObservation, obs: AgentObservation): boolean {
    return (
      m.perceivedReliability !== null &&
      m.perceivedSampleSize >= MIN_EVIDENCE &&
      m.perceivedReliability < obs.objective.minReliabilityThreshold
    )
  }

  private best(cands: Candidate[], obs: AgentObservation): Candidate | null {
    if (cands.length === 0) return null
    const scored = cands.map(c => ({ c, s: this.score(c.merchant, c.product, obs) }))
    // Tie-break by productId keeps ordering deterministic across identical scores
    scored.sort((a, b) => (b.s - a.s) || a.c.product.productId.localeCompare(b.c.product.productId))
    return scored[0]!.c
  }

  private score(m: MerchantObservation, p: ProductObservation, obs: AgentObservation): number {
    const policy    = this.policy
    const maxBudget = obs.objective.maxPrice.minorUnits

    const priceScore       = maxBudget > 0 ? 1 - p.price.minorUnits / maxBudget : 0
    const reliabilityScore = m.perceivedReliability ?? obs.objective.minReliabilityThreshold
    const speedScore       = FULFILLMENT_SPEED_SCORE[m.fulfillmentSpeed]
    const loyaltyBonus     = obs.currentState.preferredMerchantId === m.merchantId
      ? policy.merchantLoyalty * 0.5
      : 0

    return (
      policy.priceSensitivity    * priceScore       +
      policy.reliabilityWeight   * reliabilityScore +
      policy.shippingSpeedWeight * speedScore       +
      loyaltyBonus
    )
  }
}

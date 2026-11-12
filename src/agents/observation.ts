// src/agents/observation.ts

import type { Agent, AgentObservation, MerchantObservation, ProductObservation } from '../domain/agent'
import type { WorldState } from '../simulation/world'

const RECENT_OUTCOMES = 6    // consider the last N outcomes at each merchant
const PRIOR_RATE      = 0.8  // optimistic prior for an untested merchant
const PRIOR_WEIGHT    = 2    // prior counts as this many pseudo-observations

export function buildObservation(agent: Agent, world: WorldState): AgentObservation {
  const merchants: MerchantObservation[] = []

  for (const merchant of world.getMerchants()) {
    if (merchant.status === 'unavailable') continue

    const products: ProductObservation[] = world
      .getProductsByMerchant(merchant.id)
      .map(p => ({
        productId:             p.id,
        name:                  p.name,
        category:              p.category,
        price:                 p.price,
        visibleInventoryCount: p.visibleInventoryCount,  // never actual
        isListedAvailable:     p.isListedAvailable,
      }))
      .filter(p => {
        const categoryOk = !agent.objective.targetCategory || p.category === agent.objective.targetCategory
        const priceOk    = p.price.minorUnits <= agent.objective.maxPrice.minorUnits
        return categoryOk && priceOk && p.isListedAvailable && p.visibleInventoryCount > 0
      })

    if (products.length === 0) continue

    const belief = perceivedFor(merchant.id, agent)

    merchants.push({
      merchantId:           merchant.id,
      name:                 merchant.name,
      priceLevel:           merchant.priceLevel,
      fulfillmentSpeed:     merchant.fulfillmentSpeed,
      returnPolicy:         merchant.returnPolicy,
      products,
      perceivedReliability: belief.rate,
      perceivedSampleSize:  belief.n,
    })
  }

  return {
    agentId:                agent.id,
    tick:                   world.tick,
    currentState:           { ...agent.state },
    availableMerchants:     merchants,
    ownRecentFailures:      [...agent.state.recentFailures],
    ownSuccessfulPurchases: [...agent.state.successfulPurchases],
    lastPaymentSummary:     agent.state.lastPaymentSummary,
    objective:              agent.objective,
  }
}

/**
 * Recency-weighted smoothed success rate from the agent's OWN outcomes at this
 * merchant only. Returns null when the agent has no history there.
 * Never reads merchant.reliability — that is ground truth the agent cannot see.
 */
function perceivedFor(merchantId: string, agent: Agent): { rate: number | null; n: number } {
  const outcomes = [
    ...agent.state.successfulPurchases
      .filter(p => p.merchantId === merchantId)
      .map(p => ({ tick: p.tick, ok: true })),
    ...agent.state.recentFailures
      .filter(f => f.merchantId === merchantId)
      .map(f => ({ tick: f.tick, ok: false })),
  ].sort((a, b) => a.tick - b.tick)

  if (outcomes.length === 0) return { rate: null, n: 0 }

  const recent = outcomes.slice(-RECENT_OUTCOMES)
  const ok     = recent.filter(o => o.ok).length
  return {
    rate: (ok + PRIOR_RATE * PRIOR_WEIGHT) / (recent.length + PRIOR_WEIGHT),
    n:    recent.length,
  }
}

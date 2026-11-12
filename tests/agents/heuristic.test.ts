// tests/agents/heuristic.test.ts
import { describe, it, expect } from 'vitest'
import { WorldState } from '../../src/simulation/world'
import { STALE_INVENTORY_WORLD } from '../../src/simulation/scenarios/stale-inventory'
import { buildObservation } from '../../src/agents/observation'
import { HeuristicAgentModelWithPolicy } from '../../src/agents/models/heuristic'

function makeWorld() {
  return new WorldState(STALE_INVENTORY_WORLD, 'run_test', 'exp_001', 'seed')
}

/** Put an agent into recovering state with one failure on merchant_a */
function putInRecovery(world: WorldState, agentId: string, retryCount = 0) {
  world.updateAgentState(agentId, {
    status:            'recovering',
    currentMerchantId: 'merchant_a',
    currentProductId:  'prod_a2',
    retryCount,
    totalFailures:     retryCount + 1,
    recentFailures: [{
      tick: 20, merchantId: 'merchant_a', productId: 'prod_a2',
      reason: 'fulfillment_failed', failureCategory: 'fulfillment_failed',
    }],
  })
}

function decide(world: WorldState, agentId: string) {
  const agent = world.getAgent(agentId)
  const obs   = buildObservation(agent, world)
  return new HeuristicAgentModelWithPolicy(agent.policy).decide(obs)
}

describe('Heuristic phenotype divergence', () => {
  it('impatient switches immediately on first failure (retryTolerance=0)', () => {
    const world = makeWorld()
    putInRecovery(world, 'agent_impatient', 0)
    const d = decide(world, 'agent_impatient')
    expect(d.action.type).toBe('SWITCH_MERCHANT')
  })

  it('loyal retries on first failure (retryTolerance=5, retryCount=0)', () => {
    const world = makeWorld()
    putInRecovery(world, 'agent_loyal', 0)
    const d = decide(world, 'agent_loyal')
    expect(d.action.type).toBe('RETRY')
  })

  it('loyal switches only after exhausting retryTolerance', () => {
    const world = makeWorld()
    putInRecovery(world, 'agent_loyal', 5) // retryCount=5 = tolerance
    const d = decide(world, 'agent_loyal')
    expect(d.action.type).toBe('SWITCH_MERCHANT')
  })

  it('reliability_first switches after one retry (retryTolerance=1)', () => {
    const world = makeWorld()
    putInRecovery(world, 'agent_reliable', 1) // at tolerance
    const d = decide(world, 'agent_reliable')
    expect(d.action.type).toBe('SWITCH_MERCHANT')
  })

  it('budget_hunter selects cheapest qualifying electronics product', () => {
    const world = makeWorld()
    // agent starts in idle — will select a product
    const d = decide(world, 'agent_budget')
    expect(d.action.type).toBe('SELECT_PRODUCT')
    if (d.action.type === 'SELECT_PRODUCT') {
      const product = world.getProduct(d.action.productId)
      expect(product.category).toBe('electronics')
      expect(product.price.minorUnits).toBeLessThanOrEqual(7500)
    }
  })

  it('impatient selects from fast-shipping merchant (GammaStore)', () => {
    const world = makeWorld()
    const d = decide(world, 'agent_impatient')
    expect(d.action.type).toBe('SELECT_PRODUCT')
    if (d.action.type === 'SELECT_PRODUCT') {
      // shippingSpeedWeight=0.80 should pull impatient toward GammaStore (fast)
      expect(d.action.merchantId).toBe('merchant_c')
    }
  })

  it('abandoned agent returns IDLE', () => {
    const world = makeWorld()
    world.updateAgentState('agent_budget', { status: 'abandoned' })
    const d = decide(world, 'agent_budget')
    expect(d.action.type).toBe('IDLE')
  })
})

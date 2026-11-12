// tests/agents/observation.test.ts
import { describe, it, expect } from 'vitest'
import { WorldState } from '../../src/simulation/world'
import { STALE_INVENTORY_WORLD } from '../../src/simulation/scenarios/stale-inventory'
import { buildObservation } from '../../src/agents/observation'

function makeWorld() {
  return new WorldState(STALE_INVENTORY_WORLD, 'run_test', 'exp_001', 'seed')
}

describe('Observation information boundary', () => {
  it('exposes visibleInventoryCount only — never actualInventoryCount', () => {
    const world = makeWorld()
    // Inject stale state: actual=0 but visible unchanged
    world.updateProduct('prod_a2', { actualInventoryCount: 0 })

    const agent = world.getAgent('agent_budget')
    const obs   = buildObservation(agent, world)

    const alpha = obs.availableMerchants.find(m => m.merchantId === 'merchant_a')
    const prod  = alpha?.products.find(p => p.productId === 'prod_a2')

    // Agent still sees 25 in stock (stale)
    expect(prod?.visibleInventoryCount).toBe(25)
    // The field 'actualInventoryCount' must not exist on the observation object
    expect('actualInventoryCount' in (prod ?? {})).toBe(false)
  })

  it('filters products outside the objective category', () => {
    const world = makeWorld()
    const agent = world.getAgent('agent_budget') // targets 'electronics'
    const obs   = buildObservation(agent, world)

    for (const m of obs.availableMerchants) {
      for (const p of m.products) {
        expect(p.category).toBe('electronics')
      }
    }
  })

  it('filters products above maxPrice', () => {
    const world = makeWorld()
    const agent = world.getAgent('agent_budget') // maxPrice $75
    const obs   = buildObservation(agent, world)

    for (const m of obs.availableMerchants) {
      for (const p of m.products) {
        expect(p.price.minorUnits).toBeLessThanOrEqual(7500)
      }
    }
  })

  it('perceivedReliability is null when agent has no history', () => {
    const world = makeWorld()
    const agent = world.getAgent('agent_reliable')
    const obs   = buildObservation(agent, world)

    for (const m of obs.availableMerchants) {
      expect(m.perceivedReliability).toBeNull()
    }
  })

  it('does not expose a different agent\'s failure history', () => {
    const world = makeWorld()
    // Record a failure on agent_budget
    world.updateAgentState('agent_budget', {
      recentFailures: [{
        tick: 5, merchantId: 'merchant_a', productId: 'prod_a2',
        reason: 'test', failureCategory: 'payment_failed',
      }],
    })

    // agent_reliable should see no failures
    const agent = world.getAgent('agent_reliable')
    const obs   = buildObservation(agent, world)
    expect(obs.ownRecentFailures).toHaveLength(0)
  })
})

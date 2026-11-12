// tests/agents/model-correctness.test.ts

import { describe, it, expect } from 'vitest'
import { WorldState } from '../../src/simulation/world'
import { STALE_INVENTORY_WORLD, EXPERIMENT_001 } from '../../src/simulation/scenarios/stale-inventory'
import { buildObservation } from '../../src/agents/observation'
import { HeuristicAgentModelWithPolicy } from '../../src/agents/models/heuristic'
import { SimulationEngine } from '../../src/simulation/engine'
import { usd } from '../../src/domain/money'

function makeWorld() {
  return new WorldState(STALE_INVENTORY_WORLD, 'run_test', 'exp_001', 'seed')
}

function decide(world: WorldState, agentId: string) {
  const agent = world.getAgent(agentId)
  return new HeuristicAgentModelWithPolicy(agent.policy).decide(buildObservation(agent, world))
}

describe('model correctness', () => {
  it('a switch is binding: next selection stays on the target merchant', () => {
    const world = makeWorld()
    world.updateAgentState('agent_budget', {
      status: 'idle', currentMerchantId: 'merchant_b', currentProductId: null,
    })
    const d = decide(world, 'agent_budget')
    expect(d.action.type).toBe('SELECT_PRODUCT')
    if (d.action.type === 'SELECT_PRODUCT') {
      expect(d.action.merchantId).toBe('merchant_b')
    }
  })

  it('one bad outcome per merchant does not cause an agent to abandon', () => {
    const world = makeWorld()
    const fail = (m: string, p: string) => ({
      tick: 3, merchantId: m, productId: p, reason: 'x',
      failureCategory: 'payment_failed' as const,
    })
    world.updateAgentState('agent_balanced', {
      recentFailures: [
        fail('merchant_a', 'prod_a4'),
        fail('merchant_b', 'prod_b3'),
        fail('merchant_c', 'prod_c3'),
      ],
    })
    expect(decide(world, 'agent_balanced').action.type).toBe('SELECT_PRODUCT')
  })

  it('perceived reliability is recency-weighted, not lifetime-average', () => {
    const world    = makeWorld()
    const successes = Array.from({ length: 9 }, (_, i) => ({
      tick: i + 1, orderId: `o${i}`,
      merchantId: 'merchant_a', productId: 'prod_a2', price: usd(45),
    }))
    const failures = [20, 21, 22].map(t => ({
      tick: t, merchantId: 'merchant_a', productId: 'prod_a2',
      reason: 'x', failureCategory: 'fulfillment_failed' as const,
    }))
    world.updateAgentState('agent_budget', { successfulPurchases: successes, recentFailures: failures })

    const obs = buildObservation(world.getAgent('agent_budget'), world)
    const a   = obs.availableMerchants.find(m => m.merchantId === 'merchant_a')!

    // Last 6 outcomes: 3 successes + 3 failures
    // Smoothed: (3 + 0.8*2) / (6 + 2) = 4.6/8 = 0.575
    expect(a.perceivedReliability).toBeCloseTo(0.575, 3)
    expect(a.perceivedSampleSize).toBe(6)
  })

  it('same seed produces identical canonical event fingerprint across two runs', async () => {
    const run = (id: string) => new SimulationEngine().execute({
      experiment: EXPERIMENT_001, runId: id, seed: 'wind-tunnel-001',
      paypalMode: 'simulated', mode: 'fresh',
    })

    const fingerprint = (r: Awaited<ReturnType<typeof run>>) =>
      r.bus.getBuffer().map(e => `${e.tick}|${e.type}|${e.agentId}|${e.merchantId}`)

    const [a, b] = await Promise.all([run('fp_a'), run('fp_b')])
    expect(fingerprint(a)).toEqual(fingerprint(b))
  })
})

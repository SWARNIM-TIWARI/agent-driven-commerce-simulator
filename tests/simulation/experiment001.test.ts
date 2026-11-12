import { describe, it, expect } from 'vitest'
import { SimulationEngine } from '../../src/simulation/engine'
import { EXPERIMENT_001 } from '../../src/simulation/scenarios/stale-inventory'

async function run(runId: string) {
  return new SimulationEngine().execute({
    experiment: EXPERIMENT_001, runId, seed: 'wind-tunnel-001',
    paypalMode: 'simulated', mode: 'fresh',
  })
}

describe('Experiment 001', () => {
  it('injection fires exactly once, at tick 20', async () => {
    const r = await run('t1')
    const inj = r.bus.getByType('INJECTION_APPLIED')
    expect(inj).toHaveLength(1)
    expect(inj[0]?.tick).toBe(20)
  })

  it('injection fires again on a second run in the same process', async () => {
    await run('t2')
    const r = await run('t3')
    expect(r.bus.getByType('INJECTION_APPLIED')).toHaveLength(1)
  })

  it('agents are still active at the injection and hit AlphaShop failures after it', async () => {
    const r = await run('t4')
    const failures = r.bus.getByType('ORDER_FULFILLMENT_FAILED')
      .filter(e => e.tick >= 20 && e.merchantId === 'merchant_a')
    expect(failures.length).toBeGreaterThan(0)
  })
})

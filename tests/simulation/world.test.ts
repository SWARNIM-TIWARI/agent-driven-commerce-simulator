// tests/simulation/world.test.ts
import { describe, it, expect } from 'vitest'
import { WorldState } from '../../src/simulation/world'
import { STALE_INVENTORY_WORLD } from '../../src/simulation/scenarios/stale-inventory'

describe('WorldState', () => {
  function makeWorld() {
    return new WorldState(STALE_INVENTORY_WORLD, 'run_test', 'exp_001', 'wind-tunnel-001')
  }

  it('initializes the correct number of merchants', () => {
    const world = makeWorld()
    expect(world.getMerchants().length).toBe(3)
  })

  it('initializes products with visible === actual inventory', () => {
    const world = makeWorld()
    for (const p of world.getProducts()) {
      expect(p.visibleInventoryCount).toBe(p.actualInventoryCount)
      expect(p.actualInventoryCount).toBe(p.initialInventoryCount)
    }
  })

  it('returns agents in deterministic sorted order', () => {
    const world = makeWorld()
    const ids = world.getAgents().map(a => a.id)
    expect(ids).toEqual([...ids].sort())
  })

  it('updateProduct changes actual without touching visible', () => {
    const world = makeWorld()
    world.updateProduct('prod_a1', { actualInventoryCount: 0 })
    const p = world.getProduct('prod_a1')
    expect(p.actualInventoryCount).toBe(0)
    expect(p.visibleInventoryCount).toBe(30) // unchanged
  })

  it('two worlds with the same seed produce identical product state', () => {
    const w1 = new WorldState(STALE_INVENTORY_WORLD, 'run_1', 'exp_001', 'same-seed')
    const w2 = new WorldState(STALE_INVENTORY_WORLD, 'run_2', 'exp_001', 'same-seed')
    const snap1 = w1.snapshot()
    const snap2 = w2.snapshot()
    expect(snap1.products).toEqual(snap2.products)
    expect(snap1.agents).toEqual(snap2.agents)
  })
})

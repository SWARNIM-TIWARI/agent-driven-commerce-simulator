// tests/replay/integrity.test.ts
import { describe, it, expect } from 'vitest'
import { InMemoryDecisionRecorder } from '../../src/agents/models/recorded'

const mockDecision = (agentId: string, tick: number, seq: number) => ({
  id:                  `dec_${agentId}_${tick}_${seq}`,
  agentId,
  tick,
  sequenceIndex:       seq,
  action:              { type: 'IDLE' as const },
  rationale:           null,
  confidence:          null,
  modelType:           'heuristic' as const,
  observationSnapshot: {} as any,
})

describe('InMemoryDecisionRecorder', () => {
  it('records and retrieves by compound key', () => {
    const r = new InMemoryDecisionRecorder()
    r.record(mockDecision('agent_budget', 5, 2))
    expect(r.get('agent_budget', 5, 2)?.action.type).toBe('IDLE')
  })

  it('returns null for positions that were never recorded', () => {
    const r = new InMemoryDecisionRecorder()
    expect(r.get('agent_budget', 99, 0)).toBeNull()
  })

  it('different compound keys do not collide', () => {
    const r = new InMemoryDecisionRecorder()
    r.record(mockDecision('agent_a', 1, 0))
    r.record(mockDecision('agent_b', 1, 0))
    expect(r.get('agent_a', 1, 0)?.agentId).toBe('agent_a')
    expect(r.get('agent_b', 1, 0)?.agentId).toBe('agent_b')
  })

  it('serialize → hydrate round-trip preserves all decisions', () => {
    const r1 = new InMemoryDecisionRecorder()
    r1.record(mockDecision('agent_loyal', 10, 0))
    r1.record(mockDecision('agent_loyal', 11, 1))

    const r2 = new InMemoryDecisionRecorder()
    r2.hydrate(r1.serialize())

    expect(r2.get('agent_loyal', 10, 0)?.agentId).toBe('agent_loyal')
    expect(r2.get('agent_loyal', 11, 1)?.sequenceIndex).toBe(1)
  })

  it('integrityHash is identical for two recorders with the same decisions', () => {
    const r1 = new InMemoryDecisionRecorder()
    const r2 = new InMemoryDecisionRecorder()
    const dec = mockDecision('agent_budget', 3, 0)
    r1.record(dec)
    r2.record(dec)
    expect(r1.integrityHash()).toBe(r2.integrityHash())
  })

  it('integrityHash differs when decisions differ', () => {
    const r1 = new InMemoryDecisionRecorder()
    const r2 = new InMemoryDecisionRecorder()
    r1.record(mockDecision('agent_budget', 3, 0))
    r2.record(mockDecision('agent_impatient', 3, 0))
    expect(r1.integrityHash()).not.toBe(r2.integrityHash())
  })
})

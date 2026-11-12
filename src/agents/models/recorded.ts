// src/agents/models/recorded.ts

import type { AgentDecision, AgentObservation, AgentPolicy } from '../../domain/agent'
import { hashSeed } from '../../simulation/prng'

export interface RecordedDecisionProvider {
  record(decision: AgentDecision): void
  get(agentId: string, tick: number, sequenceIndex: number): AgentDecision | null
  serialize():   string
  hydrate(s: string): void
  integrityHash(): string
}

export class InMemoryDecisionRecorder implements RecordedDecisionProvider {
  private decisions: Map<string, AgentDecision> = new Map()

  private key(agentId: string, tick: number, seq: number): string {
    return `${agentId}:${tick}:${seq}`
  }

  record(decision: AgentDecision): void {
    this.decisions.set(this.key(decision.agentId, decision.tick, decision.sequenceIndex), decision)
  }

  get(agentId: string, tick: number, sequenceIndex: number): AgentDecision | null {
    return this.decisions.get(this.key(agentId, tick, sequenceIndex)) ?? null
  }

  serialize(): string {
    const arr = Array.from(this.decisions.values())
    return JSON.stringify(arr)
  }

  hydrate(s: string): void {
    const arr: AgentDecision[] = JSON.parse(s)
    for (const d of arr) {
      this.decisions.set(this.key(d.agentId, d.tick, d.sequenceIndex), d)
    }
  }

  integrityHash(): string {
    // Hash all decisions in deterministic order
    const sorted = Array.from(this.decisions.values())
      .sort((a, b) => {
        if (a.agentId !== b.agentId) return a.agentId.localeCompare(b.agentId)
        if (a.tick    !== b.tick)    return a.tick    - b.tick
        return a.sequenceIndex - b.sequenceIndex
      })
    const canonical = sorted.map(d => `${d.agentId}:${d.tick}:${d.sequenceIndex}:${d.action.type}`).join('|')
    return hashSeed(canonical).toString(16)
  }
}

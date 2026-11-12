// src/agents/tools/search-products.ts

import type { WorldState } from '../../simulation/world'
import type { Agent } from '../../domain/agent'
import { buildObservation } from '../observation'
import type { AgentObservation } from '../../domain/agent'

export interface SearchResult {
  observation: AgentObservation
  merchantCount: number
  productCount: number
}

/** Returns an updated observation — effectively a catalog search result */
export function searchProducts(agent: Agent, world: WorldState): SearchResult {
  const observation = buildObservation(agent, world)
  return {
    observation,
    merchantCount: observation.availableMerchants.length,
    productCount:  observation.availableMerchants.reduce((sum, m) => sum + m.products.length, 0),
  }
}

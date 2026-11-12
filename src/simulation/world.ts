// src/simulation/world.ts

import type { Merchant, MerchantConfig } from '../domain/merchant'
import type { Product, ProductConfig } from '../domain/product'
import type { Agent, AgentConfig } from '../domain/agent'
import type { Order } from '../domain/order'
import type { Transaction } from '../domain/transaction'
import type { WorldConfig } from '../domain/experiment'
import { merchantFromConfig } from '../domain/merchant'
import { productFromConfig } from '../domain/product'
import { agentFromConfig } from '../domain/agent'

/**
 * WorldState is the single source of truth during a simulation run.
 * The database is a persistence sink — never read during simulation.
 * All tools must read from and write to WorldState, never the DB.
 */
export class WorldState {
  readonly runId:       string
  readonly experimentId: string
  readonly seed:        string

  private _tick:        number = 0
  private merchants:    Map<string, Merchant>    = new Map()
  private products:     Map<string, Product>     = new Map()
  private agents:       Map<string, Agent>       = new Map()
  private orders:       Map<string, Order>       = new Map()
  private transactions: Map<string, Transaction> = new Map()

  constructor(config: WorldConfig, runId: string, experimentId: string, seed: string) {
    this.runId        = runId
    this.experimentId = experimentId
    this.seed         = seed

    for (const mc of config.merchants) {
      this.merchants.set(mc.id, merchantFromConfig(mc))
    }
    for (const pc of config.products) {
      this.products.set(pc.id, productFromConfig(pc))
    }
    for (const ac of config.agents) {
      this.agents.set(ac.id, agentFromConfig(ac))
    }
  }

  // ── Tick ───────────────────────────────────────────────────

  get tick(): number { return this._tick }

  advanceTick(): void { this._tick++ }

  // ── Merchants ──────────────────────────────────────────────

  getMerchant(id: string): Merchant {
    const m = this.merchants.get(id)
    if (!m) throw new Error(`Unknown merchant: ${id}`)
    return m
  }

  getMerchants(): Merchant[] {
    return Array.from(this.merchants.values())
  }

  updateMerchant(id: string, update: Partial<Merchant>): void {
    const m = this.getMerchant(id)
    Object.assign(m, update)
  }

  // ── Products ───────────────────────────────────────────────

  getProduct(id: string): Product {
    const p = this.products.get(id)
    if (!p) throw new Error(`Unknown product: ${id}`)
    return p
  }

  getProducts(): Product[] {
    return Array.from(this.products.values())
  }

  getProductsByMerchant(merchantId: string): Product[] {
    return this.getProducts().filter(p => p.merchantId === merchantId)
  }

  updateProduct(id: string, update: Partial<Product>): void {
    const p = this.getProduct(id)
    Object.assign(p, update)
  }

  // ── Agents ─────────────────────────────────────────────────

  getAgent(id: string): Agent {
    const a = this.agents.get(id)
    if (!a) throw new Error(`Unknown agent: ${id}`)
    return a
  }

  getAgents(): Agent[] {
    // Deterministic order: sorted by ID for reproducibility
    return Array.from(this.agents.values()).sort((a, b) => a.id.localeCompare(b.id))
  }

  updateAgentState(agentId: string, update: Partial<Agent['state']>): void {
    const a = this.getAgent(agentId)
    Object.assign(a.state, update)
  }

  // ── Orders ─────────────────────────────────────────────────

  getOrder(id: string): Order | undefined {
    return this.orders.get(id)
  }

  upsertOrder(order: Order): void {
    this.orders.set(order.id, order)
  }

  getOrdersByAgent(agentId: string): Order[] {
    return Array.from(this.orders.values()).filter(o => o.agentId === agentId)
  }

  // ── Transactions ───────────────────────────────────────────

  upsertTransaction(tx: Transaction): void {
    this.transactions.set(tx.id, tx)
  }

  getTransactionsByOrder(orderId: string): Transaction[] {
    return Array.from(this.transactions.values()).filter(t => t.orderId === orderId)
  }

  // ── Snapshot (for replay integrity hash) ──────────────────

  snapshot(): WorldSnapshot {
    return {
      tick:      this._tick,
      agents:    this.getAgents().map(a => ({
        id:     a.id,
        status: a.state.status,
        retryCount:          a.state.retryCount,
        totalFailures:       a.state.totalFailures,
        merchantSwitchCount: a.state.merchantSwitchCount,
        successCount:        a.state.successfulPurchases.length,
        currentMerchantId:   a.state.currentMerchantId,
      })),
      products:  this.getProducts().map(p => ({
        id:                  p.id,
        actualInventoryCount: p.actualInventoryCount,
        visibleInventoryCount: p.visibleInventoryCount,
      })),
    }
  }
}

export interface WorldSnapshot {
  tick:     number
  agents:   Array<{
    id:                  string
    status:              string
    retryCount:          number
    totalFailures:       number
    merchantSwitchCount: number
    successCount:        number
    currentMerchantId:   string | null
  }>
  products: Array<{
    id:                    string
    actualInventoryCount:  number
    visibleInventoryCount: number
  }>
}

/** Canonical hash of a WorldSnapshot for replay integrity comparison */
export function hashSnapshot(snap: WorldSnapshot): string {
  const canonical = JSON.stringify(snap, Object.keys(snap).sort())
  let h = 5381
  for (let i = 0; i < canonical.length; i++) {
    h = ((h << 5) + h) ^ canonical.charCodeAt(i)
    h = h >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

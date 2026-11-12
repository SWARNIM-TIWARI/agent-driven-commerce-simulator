// src/simulation/injector.ts

import type { ScenarioConfig, ScenarioInjection } from '../domain/experiment'
import type { WorldState } from './world'
import type { EventBus } from '../events/bus'
import { nextEventId } from './prng'
import type { InjectionAppliedEvent, InventoryStaleCreatedEvent } from '../events/types'

export class ScenarioInjector {
  // Tracked per-injector instance, NOT on the shared config object,
  // so a second run in the same process (replay, tests) still injects.
  private readonly appliedIds = new Set<string>()

  constructor(
    private readonly scenario: ScenarioConfig,
    private readonly world:    WorldState,
    private readonly bus:      EventBus,
  ) {}

  /** Apply injections scheduled at this tick. Returns injection IDs applied. */
  checkAndApply(tick: number): string[] {
    const applied: string[] = []

    for (const injection of this.scenario.injections) {
      if (!this.appliedIds.has(injection.id) && injection.atTick === tick) {
        this.applyInjection(injection, tick)
        this.appliedIds.add(injection.id)
        applied.push(injection.id)
      }
    }

    return applied
  }

  private applyInjection(injection: ScenarioInjection, tick: number): void {
    switch (injection.type) {
      case 'STALE_INVENTORY':
        this.applyStaleInventory(injection, tick)
        break
      default:
        console.warn(`[Injector] Unknown injection type: ${injection.type}`)
    }
  }

  private applyStaleInventory(injection: ScenarioInjection, tick: number): void {
    const params = injection.parameters as {
      setActualInventoryTo:  number
      setVisibleInventoryTo: number | null
    }

    const targetMerchantId = injection.targetMerchantId
    const targetProductId  = injection.targetProductId
    const affectedIds: string[] = []

    for (const product of this.world.getProducts()) {
      const matchesMerchant = !targetMerchantId || product.merchantId === targetMerchantId
      const matchesProduct  = !targetProductId  || product.id === targetProductId

      if (matchesMerchant && matchesProduct) {
        // Ground truth changes; visible inventory stays stale unless explicitly set
        this.world.updateProduct(product.id, {
          actualInventoryCount: params.setActualInventoryTo,
        })
        if (params.setVisibleInventoryTo !== null) {
          this.world.updateProduct(product.id, {
            visibleInventoryCount: params.setVisibleInventoryTo,
          })
        }
        affectedIds.push(product.id)
      }
    }

    const injEvent: InjectionAppliedEvent = {
      id:       nextEventId(this.world.runId),
      runId:    this.world.runId,
      tick,
      wallTime: Date.now(),
      type:     'INJECTION_APPLIED',
      payload: {
        injectionId:       injection.id,
        injectionType:     injection.type,
        targetMerchantId:  injection.targetMerchantId,
        targetProductId:   injection.targetProductId,
        parametersApplied: injection.parameters,
        systemOnly:        true,
      },
      agentId: null, merchantId: targetMerchantId ?? null, orderId: null, transactionId: null,
    }
    this.bus.emit(injEvent)

    const staleEvent: InventoryStaleCreatedEvent = {
      id:       nextEventId(this.world.runId),
      runId:    this.world.runId,
      tick,
      wallTime: Date.now(),
      type:     'INVENTORY_STALE_CREATED',
      payload: {
        affectedProductIds: affectedIds,
        visibleCount:       -1,
        actualCount:        params.setActualInventoryTo,
        systemOnly:         true,
      },
      agentId: null, merchantId: targetMerchantId ?? null, orderId: null, transactionId: null,
    }
    this.bus.emit(staleEvent)
  }
}

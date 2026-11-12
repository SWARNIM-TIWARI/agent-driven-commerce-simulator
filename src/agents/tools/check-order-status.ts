// src/agents/tools/check-order-status.ts

import type { WorldState } from '../../simulation/world'
import type { Order } from '../../domain/order'

export function checkOrderStatus(orderId: string, world: WorldState): Order | null {
  return world.getOrder(orderId) ?? null
}

// src/payments/simulated.ts

import type {
  PaymentProvider,
  CreateOrderParams, PaymentOrderResult,
  CaptureOrderParams, PaymentCaptureResult,
  RefundParams, RefundResult,
} from './provider'
import type { WorldState } from '../simulation/world'
import { createPRNG, type PRNG } from '../simulation/prng'

export interface SimulatedConfig {
  readonly seed:                   string
  readonly inventoryFailureEnabled: boolean  // fail when actualInventoryCount = 0
  readonly baseCaptureFail:        number    // 0–1 random capture failure rate
}

/**
 * SimulatedPaymentProvider — used in Phase 1 and for offline testing.
 *
 * IMPORTANT: This provider checks world.getProduct(productId).actualInventoryCount.
 * The stale inventory failure manifests HERE — after payment initiation.
 * This means: payment is initiated → fulfillment check fails → refund path.
 * This is structurally closer to the real PayPal → fulfill → fail → refund sequence.
 */
export class SimulatedPaymentProvider implements PaymentProvider {
  readonly name         = 'SimulatedPaymentProvider'
  readonly providerType = 'simulated' as const

  private prng: PRNG

  constructor(
    private readonly config: SimulatedConfig,
    private readonly world:  WorldState,
  ) {
    this.prng = createPRNG(`${config.seed}:payments`)
  }

  async createOrder(params: CreateOrderParams): Promise<PaymentOrderResult> {
    // Order creation always succeeds in simulation (equivalent to PayPal order created)
    const providerOrderId = `sim_ord_${params.internalOrderId}`
    return {
      success:         true,
      providerOrderId,
      status:          'created',
      rawResponse:     { simulated: true, orderId: providerOrderId },
      error:           null,
      errorCode:       null,
    }
  }

  async captureOrder(params: CaptureOrderParams): Promise<PaymentCaptureResult> {
    // Check actual inventory — this is the stale inventory failure point
    if (this.config.inventoryFailureEnabled) {
      const order = this.world.getOrder(params.internalOrderId)
      if (order) {
        const product = this.world.getProduct(order.productId)
        if (product.actualInventoryCount <= 0) {
          return {
            success:           false,
            providerCaptureId: null,
            status:            'failed',
            amount:            null,
            rawResponse:       { simulated: true, reason: 'INVENTORY_UNAVAILABLE' },
            error:             'FULFILLMENT_ERROR: product no longer available',
            errorCode:         'INVENTORY_UNAVAILABLE',
          }
        }
      }
    }

    // Random capture failure (simulates real-world payment failures)
    if (this.prng() < this.config.baseCaptureFail) {
      return {
        success:           false,
        providerCaptureId: null,
        status:            'failed',
        amount:            null,
        rawResponse:       { simulated: true, reason: 'PAYMENT_DECLINED' },
        error:             'PAYMENT_DECLINED: simulated random failure',
        errorCode:         'INSTRUMENT_DECLINED',
      }
    }

    const captureId = `sim_cap_${params.internalOrderId}`
    return {
      success:           true,
      providerCaptureId: captureId,
      status:            'captured',
      amount:            null,   // filled in by caller from order
      rawResponse:       { simulated: true, captureId },
      error:             null,
      errorCode:         null,
    }
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const refundId = `sim_ref_${params.internalOrderId}`
    return {
      success:          true,
      providerRefundId: refundId,
      status:           'completed',
      rawResponse:      { simulated: true, refundId },
      error:            null,
    }
  }
}

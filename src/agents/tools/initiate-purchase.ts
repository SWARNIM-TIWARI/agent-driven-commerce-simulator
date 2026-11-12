// src/agents/tools/initiate-purchase.ts

import type { WorldState } from '../../simulation/world'
import type { Agent, PaymentSummary, FailureCategory } from '../../domain/agent'
import type { PaymentProvider } from '../../payments/provider'
import type { Order } from '../../domain/order'
import type { Transaction } from '../../domain/transaction'
import { deterministicId } from '../../simulation/prng'
import { money } from '../../domain/money'

export interface PurchaseAttemptResult {
  success:        boolean
  orderId:        string
  transactionId:  string | null
  paymentSummary: PaymentSummary
  order:          Order
  transaction:    Transaction | null
}

export async function initiatePurchase(
  agent:    Agent,
  world:    WorldState,
  provider: PaymentProvider,
  tick:     number,
): Promise<PurchaseAttemptResult> {
  const state     = agent.state
  const productId = state.currentProductId!
  const merchantId = state.currentMerchantId!
  const product   = world.getProduct(productId)

  // Build the logical purchase key — stable across fresh and replay runs
  const logicalPurchaseKey = [
    world.experimentId,
    world.seed,
    agent.id,
    state.decisionSequenceNumber,
    state.retryCount,
  ].join(':')

  const internalOrderId = deterministicId('ord', logicalPurchaseKey)
  const amount = product.price

  // Create order
  const orderResult = await provider.createOrder({
    logicalPurchaseKey,
    internalOrderId,
    agentId:    agent.id,
    merchantId,
    productId,
    amount,
    description: `${agent.name} purchasing ${product.name} from ${merchantId}`,
    runId:      world.runId,
    tick,
  })

  if (!orderResult.success) {
    const order: Order = {
      logicalPurchaseKey,
      id:              internalOrderId,
      runId:           world.runId,
      paypalOrderId:   null,
      agentId:         agent.id,
      agentPhenotype:  agent.phenotype,
      merchantId,
      productId,
      quantity:        1,
      unitPrice:       amount,
      totalAmount:     amount,
      currency:        amount.currency,
      status:          'payment_failed',
      failureReason:   orderResult.error,
      failureCategory: 'payment_failed',
      createdAtTick:   tick,
      updatedAtTick:   tick,
    }
    world.upsertOrder(order)

    const summary: PaymentSummary = {
      success:         false,
      orderId:         internalOrderId,
      amount:          null,
      error:           orderResult.error,
      failureCategory: 'payment_failed',
      tick,
    }
    return { success: false, orderId: internalOrderId, transactionId: null, paymentSummary: summary, order, transaction: null }
  }

  // Order created — persist initial order state
  const order: Order = {
    logicalPurchaseKey,
    id:              internalOrderId,
    runId:           world.runId,
    paypalOrderId:   orderResult.providerOrderId,
    agentId:         agent.id,
    agentPhenotype:  agent.phenotype,
    merchantId,
    productId,
    quantity:        1,
    unitPrice:       amount,
    totalAmount:     amount,
    currency:        amount.currency,
    status:          'payment_initiated',
    failureReason:   null,
    failureCategory: null,
    createdAtTick:   tick,
    updatedAtTick:   tick,
  }
  world.upsertOrder(order)

  // Capture — this is where the stale inventory check happens
  const captureResult = await provider.captureOrder({
    providerOrderId: orderResult.providerOrderId!,
    internalOrderId,
    runId:           world.runId,
    tick,
  })

  const txnId = deterministicId('txn', logicalPurchaseKey + ':capture')

  if (!captureResult.success) {
    // Determine failure category
    const failureCategory: FailureCategory =
      captureResult.errorCode === 'INVENTORY_UNAVAILABLE' ? 'fulfillment_failed' : 'payment_failed'

    order.status          = failureCategory === 'fulfillment_failed' ? 'fulfillment_failed' : 'payment_failed'
    order.failureReason   = captureResult.error
    order.failureCategory = failureCategory
    order.updatedAtTick   = tick
    world.upsertOrder(order)

    const txn: Transaction = {
      id:               txnId,
      runId:            world.runId,
      orderId:          internalOrderId,
      agentId:          agent.id,
      merchantId,
      amount,
      status:           'failed',
      paypalCaptureId:  null,
      failureReason:    captureResult.error,
      createdAtTick:    tick,
      updatedAtTick:    tick,
    }
    world.upsertTransaction(txn)

    // If fulfillment failed after payment was committed, we need a refund
    // (In Phase 1 with simulated provider, this is bookkeeping only)
    if (failureCategory === 'fulfillment_failed') {
      await provider.refund({
        providerCaptureId: orderResult.providerOrderId!,
        internalOrderId,
        amount,
        reason:            'fulfillment_failed',
        runId:             world.runId,
        tick,
      })
      order.status = 'refunded'
      order.updatedAtTick = tick
      world.upsertOrder(order)
    }

    const summary: PaymentSummary = {
      success:         false,
      orderId:         internalOrderId,
      amount:          null,
      error:           captureResult.error,
      failureCategory,
      tick,
    }
    return { success: false, orderId: internalOrderId, transactionId: txnId, paymentSummary: summary, order, transaction: txn }
  }

  // Success: decrement actual inventory
  const current = world.getProduct(productId)
  world.updateProduct(productId, {
    actualInventoryCount:  Math.max(0, current.actualInventoryCount - 1),
    visibleInventoryCount: Math.max(0, current.visibleInventoryCount - 1),
  })

  order.status      = 'fulfilled'
  order.updatedAtTick = tick
  world.upsertOrder(order)

  const txn: Transaction = {
    id:               txnId,
    runId:            world.runId,
    orderId:          internalOrderId,
    agentId:          agent.id,
    merchantId,
    amount,
    status:           'captured',
    paypalCaptureId:  captureResult.providerCaptureId,
    failureReason:    null,
    createdAtTick:    tick,
    updatedAtTick:    tick,
  }
  world.upsertTransaction(txn)

  const summary: PaymentSummary = {
    success:         true,
    orderId:         internalOrderId,
    amount,
    error:           null,
    failureCategory: null,
    tick,
  }
  return { success: true, orderId: internalOrderId, transactionId: txnId, paymentSummary: summary, order, transaction: txn }
}

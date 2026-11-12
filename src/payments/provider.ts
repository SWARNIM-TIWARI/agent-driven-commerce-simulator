// src/payments/provider.ts

import type { Money } from '../domain/money'

export interface CreateOrderParams {
  logicalPurchaseKey: string
  internalOrderId:    string
  agentId:            string
  merchantId:         string
  productId:          string
  amount:             Money
  description:        string
  runId:              string
  tick:               number
}

export interface PaymentOrderResult {
  success:         boolean
  providerOrderId: string | null   // PayPal order ID (sandbox) or simulated UUID
  status:          'created' | 'failed'
  rawResponse:     unknown
  error:           string | null
  errorCode:       string | null
}

export interface CaptureOrderParams {
  providerOrderId:    string
  internalOrderId:    string
  runId:              string
  tick:               number
}

export interface PaymentCaptureResult {
  success:          boolean
  providerCaptureId: string | null  // PayPal capture ID
  status:           'captured' | 'failed' | 'pending'
  amount:           Money | null
  rawResponse:      unknown
  error:            string | null
  errorCode:        string | null
}

export interface RefundParams {
  providerCaptureId: string
  internalOrderId:   string
  amount:            Money
  reason:            string
  runId:             string
  tick:              number
}

export interface RefundResult {
  success:          boolean
  providerRefundId: string | null
  status:           'completed' | 'pending' | 'failed'
  rawResponse:      unknown
  error:            string | null
}

/**
 * PaymentProvider is the abstraction between the simulation engine and
 * any actual payment infrastructure. The domain never imports PayPal directly.
 */
export interface PaymentProvider {
  readonly name:         string
  readonly providerType: 'paypal_sandbox' | 'simulated' | 'recorded'

  createOrder(params: CreateOrderParams):  Promise<PaymentOrderResult>
  captureOrder(params: CaptureOrderParams): Promise<PaymentCaptureResult>
  refund(params: RefundParams):            Promise<RefundResult>
}

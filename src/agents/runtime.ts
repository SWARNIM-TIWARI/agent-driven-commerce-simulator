// src/agents/runtime.ts

import type { Agent, AgentAction, AgentDecision, AgentStatus, FailureCategory } from '../domain/agent'
import type { WorldState } from '../simulation/world'
import type { EventBus } from '../events/bus'
import type { PaymentProvider } from '../payments/provider'
import type { SimEvent } from '../events/types'
import type { RecordedDecisionProvider } from './models/recorded'
import { buildObservation } from './observation'
import { HeuristicAgentModelWithPolicy } from './models/heuristic'
import { initiatePurchase } from './tools/initiate-purchase'
import { nextEventId } from '../simulation/prng'

export interface AgentStepResult {
  acted:    boolean
  decision: AgentDecision | null
  events:   SimEvent[]
}

export class AgentRuntime {
  constructor(
    private readonly world:     WorldState,
    private readonly bus:       EventBus,
    private readonly provider:  PaymentProvider,
    private readonly recorder?: RecordedDecisionProvider,
  ) {}

  async step(agent: Agent, tick: number): Promise<AgentStepResult> {
    const state = agent.state

    if (state.status === 'completed' || state.status === 'abandoned') {
      return { acted: false, decision: null, events: [] }
    }

    const events: SimEvent[] = []
    const emit = (e: SimEvent) => { events.push(e); this.bus.emit(e) }

    const observation = buildObservation(agent, this.world)
    const model       = new HeuristicAgentModelWithPolicy(agent.policy)
    const decision    = model.decide(observation)

    this.recorder?.record(decision)

    this.world.updateAgentState(agent.id, {
      decisionSequenceNumber: state.decisionSequenceNumber + 1,
      lastDecisionTick:       tick,
      lastDecisionAction:     decision.action.type,
    })

    emit({
      id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
      type: 'AGENT_DECISION_MADE',
      payload: {
        phenotype:           agent.phenotype,
        action:              decision.action,
        modelType:           'heuristic',
        confidence:          null,
        rationale:           null,
        retryCount:          state.retryCount,
        merchantSwitchCount: state.merchantSwitchCount,
        sequenceIndex:       decision.sequenceIndex,
      },
      agentId: agent.id, merchantId: state.currentMerchantId, orderId: null, transactionId: null,
    })

    await this.executeAction(agent, decision.action, tick, emit)

    return { acted: true, decision, events }
  }

  private async executeAction(
    agent:  Agent,
    action: AgentAction,
    tick:   number,
    emit:   (e: SimEvent) => void,
  ): Promise<void> {
    const state = agent.state

    switch (action.type) {

      case 'SELECT_PRODUCT': {
        const resultsCount = buildObservation(agent, this.world).availableMerchants
          .reduce((n, m) => n + m.products.length, 0)

        emit({
          id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
          type: 'PRODUCT_SEARCH_EXECUTED',
          payload: {
            phenotype:      agent.phenotype,
            query:          agent.objective.targetCategory || '*',
            targetCategory: agent.objective.targetCategory,
            resultsCount,
          },
          agentId: agent.id, merchantId: null, orderId: null, transactionId: null,
        })

        const product = this.world.getProduct(action.productId)
        emit({
          id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
          type: 'PRODUCT_SELECTED',
          payload: {
            phenotype:   agent.phenotype,
            productName: product.name,
            price:       product.price,
            score:       0,
          },
          agentId: agent.id, merchantId: action.merchantId, orderId: null, transactionId: null,
        })

        this.world.updateAgentState(agent.id, {
          status:            'transacting',
          currentMerchantId: action.merchantId,
          currentProductId:  action.productId,
          retryCount:        0,
        })
        break
      }

      case 'INITIATE_PURCHASE':
      case 'RETRY': {
        if (action.type === 'RETRY') {
          emit({
            id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
            type: 'RETRY_INITIATED',
            payload: { phenotype: agent.phenotype, attemptNumber: action.attemptNumber, productId: action.productId },
            agentId: agent.id, merchantId: action.merchantId, orderId: null, transactionId: null,
          })
        } else {
          emit({
            id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
            type: 'PAYMENT_INITIATED',
            payload: { amount: this.world.getProduct(action.productId).price, providerType: 'simulated' },
            agentId: agent.id, merchantId: action.merchantId, orderId: null, transactionId: null,
          })
        }

        const result = await initiatePurchase(agent, this.world, this.provider, tick)

        if (result.success) {
          emit({
            id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
            type: 'ORDER_CREATED',
            payload: {
              logicalPurchaseKey: result.order.logicalPurchaseKey,
              phenotype:          agent.phenotype,
              productId:          result.order.productId,
              amount:             result.order.totalAmount,
              paypalOrderId:      result.order.paypalOrderId,
            },
            agentId: agent.id, merchantId: action.merchantId, orderId: result.orderId, transactionId: result.transactionId,
          })
          emit({
            id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
            type: 'PAYMENT_CAPTURED',
            payload: { amount: result.order.totalAmount, providerType: 'simulated', paypalCaptureId: null },
            agentId: agent.id, merchantId: action.merchantId, orderId: result.orderId, transactionId: result.transactionId,
          })
          emit({
            id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
            type: 'ORDER_FULFILLED',
            payload: { phenotype: agent.phenotype, productId: result.order.productId, amount: result.order.totalAmount },
            agentId: agent.id, merchantId: action.merchantId, orderId: result.orderId, transactionId: result.transactionId,
          })

          const newPurchases = [
            ...state.successfulPurchases,
            { tick, orderId: result.orderId, merchantId: action.merchantId, productId: action.productId, price: result.order.totalAmount },
          ]
          const isFirstSuccess = state.successfulPurchases.length === 0
          const newStatus: AgentStatus = newPurchases.length >= agent.objective.quantity ? 'completed' : 'idle'

          this.world.updateAgentState(agent.id, {
            status:              newStatus,
            retryCount:          0,
            currentMerchantId:   newStatus === 'idle' ? null : action.merchantId,
            currentProductId:    newStatus === 'idle' ? null : action.productId,
            successfulPurchases: newPurchases,
            preferredMerchantId: isFirstSuccess ? action.merchantId : state.preferredMerchantId,
            lastPaymentSummary:  result.paymentSummary,
          })

          if (newStatus === 'completed') {
            emit({
              id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
              type: 'AGENT_COMPLETED',
              payload: {
                phenotype:           agent.phenotype,
                successfulPurchases: newPurchases.length,
                totalFailures:       state.totalFailures,
                merchantSwitchCount: state.merchantSwitchCount,
                ticksToCompletion:   tick,
              },
              agentId: agent.id, merchantId: null, orderId: null, transactionId: null,
            })
          }
        } else {
          const failureCategory: FailureCategory = result.paymentSummary.failureCategory ?? 'payment_failed'
          const errorText = result.paymentSummary.error ?? 'unknown'

          if (failureCategory === 'fulfillment_failed') {
            emit({
              id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
              type: 'ORDER_FULFILLMENT_FAILED',
              payload: { phenotype: agent.phenotype, productId: action.productId, reason: errorText, refundIssued: true },
              agentId: agent.id, merchantId: action.merchantId, orderId: result.orderId, transactionId: result.transactionId,
            })
          } else {
            emit({
              id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
              type: 'ORDER_FAILED',
              payload: { phenotype: agent.phenotype, productId: action.productId, failureReason: errorText, failureCategory },
              agentId: agent.id, merchantId: action.merchantId, orderId: result.orderId, transactionId: result.transactionId,
            })
          }

          const newFailure = {
            tick,
            merchantId:      action.merchantId,
            productId:       action.productId,
            reason:          errorText,
            failureCategory,
          }

          this.world.updateAgentState(agent.id, {
            status:             'recovering',
            retryCount:         state.retryCount + 1,
            totalFailures:      state.totalFailures + 1,
            recentFailures:     [...state.recentFailures, newFailure].slice(-20),
            lastPaymentSummary: result.paymentSummary,
          })
        }
        break
      }

      case 'SWITCH_MERCHANT': {
        emit({
          id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
          type: 'MERCHANT_SWITCH_INITIATED',
          payload: {
            phenotype:            agent.phenotype,
            fromMerchantId:       action.fromMerchantId,
            toMerchantId:         action.toMerchantId,
            reason:               action.reason,
            failureCountAtSource: state.retryCount,
          },
          agentId: agent.id, merchantId: action.fromMerchantId, orderId: null, transactionId: null,
        })

        this.world.updateAgentState(agent.id, {
          status:              'idle',
          currentMerchantId:   action.toMerchantId,
          currentProductId:    null,
          retryCount:          0,
          merchantSwitchCount: state.merchantSwitchCount + 1,
        })
        break
      }

      case 'ABANDON': {
        emit({
          id: nextEventId(this.world.runId), runId: this.world.runId, tick, wallTime: Date.now(),
          type: 'AGENT_ABANDONED',
          payload: {
            phenotype:           agent.phenotype,
            reason:              action.reason,
            totalFailures:       state.totalFailures,
            merchantSwitchCount: state.merchantSwitchCount,
          },
          agentId: agent.id, merchantId: state.currentMerchantId, orderId: null, transactionId: null,
        })

        this.world.updateAgentState(agent.id, { status: 'abandoned' })
        break
      }

      case 'IDLE':
        break
    }
  }
}

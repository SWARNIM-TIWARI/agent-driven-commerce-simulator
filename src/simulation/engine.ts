// src/simulation/engine.ts

import type { Experiment, ExperimentRun, ScenarioConfig, WorldConfig } from '../domain/experiment'
import { WorldState, hashSnapshot } from './world'
import { EventBus } from '../events/bus'
import { ScenarioInjector } from './injector'
import { AgentRuntime } from '../agents/runtime'
import { SimulatedPaymentProvider } from '../payments/simulated'
import { InMemoryDecisionRecorder } from '../agents/models/recorded'
import { nextEventId, resetEventCounter } from './prng'
import type { RunStartedEvent, RunCompletedEvent, TickCompletedEvent } from '../events/types'

export interface EngineConfig {
  experiment:   Experiment
  runId:        string
  seed:         string
  paypalMode:   'simulated' | 'paypal_sandbox'
  mode:         'fresh' | 'replay'
  sourceRunId?: string
}

export interface RunResult {
  run:           ExperimentRun
  world:         WorldState
  bus:           EventBus
  recorder:      InMemoryDecisionRecorder
  tickSnapshots: Map<number, string>  // tick → state hash
  durationMs:    number
}

export class SimulationEngine {
  async execute(config: EngineConfig): Promise<RunResult> {
    resetEventCounter()

    const { experiment, runId, seed } = config
    const { worldConfig, scenarioConfig } = experiment

    // Initialize world
    const world    = new WorldState(worldConfig, runId, experiment.id, seed)
    const bus      = new EventBus()
    const recorder = new InMemoryDecisionRecorder()

    // Payment provider
    const provider = new SimulatedPaymentProvider(
      { seed, inventoryFailureEnabled: true, baseCaptureFail: 0.04 },
      world,
    )

    // Injector
    const injector = new ScenarioInjector(scenarioConfig, world, bus)

    // Agent runtime
    const runtime = new AgentRuntime(world, bus, provider, recorder)

    // State hash tracking for replay integrity
    const tickSnapshots = new Map<number, string>()

    const startTime = Date.now()

    // Emit RUN_STARTED
    const startEvent: RunStartedEvent = {
      id: nextEventId(runId), runId, tick: 0, wallTime: Date.now(),
      type: 'RUN_STARTED',
      payload: {
        experimentId: experiment.id,
        seed,
        mode:       config.mode,
        paypalMode: config.paypalMode,
        worldSummary: {
          merchantCount: worldConfig.merchants.length,
          productCount:  worldConfig.products.length,
          agentCount:    worldConfig.agents.length,
          totalTicks:    scenarioConfig.totalTicks,
        },
      },
      agentId: null, merchantId: null, orderId: null, transactionId: null,
    }
    bus.emit(startEvent)

    // Tick loop
    for (let tick = 1; tick <= scenarioConfig.totalTicks; tick++) {
      world.advanceTick()

      // Record state hash before any agent acts this tick
      tickSnapshots.set(tick, hashSnapshot(world.snapshot()))

      // Apply scenario injections
      const injected = injector.checkAndApply(tick)

      // Step each agent (deterministic order: sorted by ID)
      let agentsActed = 0
      for (const agent of world.getAgents()) {
        const result = await runtime.step(agent, tick)
        if (result.acted) agentsActed++
      }

      // Emit TICK_COMPLETED
      const tickEvent: TickCompletedEvent = {
        id: nextEventId(runId), runId, tick, wallTime: Date.now(),
        type: 'TICK_COMPLETED',
        payload: { tick, agentsActed, injectionsApplied: injected },
        agentId: null, merchantId: null, orderId: null, transactionId: null,
      }
      bus.emit(tickEvent)

      // Early exit if all agents are terminal
      const allDone = world.getAgents().every(a =>
        a.state.status === 'completed' || a.state.status === 'abandoned'
      )
      if (allDone) break
    }

    const durationMs = Date.now() - startTime

    // Emit RUN_COMPLETED
    const completeEvent: RunCompletedEvent = {
      id: nextEventId(runId), runId, tick: world.tick, wallTime: Date.now(),
      type: 'RUN_COMPLETED',
      payload: { totalTicks: world.tick, durationMs },
      agentId: null, merchantId: null, orderId: null, transactionId: null,
    }
    bus.emit(completeEvent)

    const run: ExperimentRun = {
      id:             runId,
      experimentId:   experiment.id,
      seed,
      mode:           config.mode,
      status:         'completed',
      paypalMode:     config.paypalMode,
      sourceRunId:    config.sourceRunId ?? null,
      startedAt:      new Date(startTime),
      completedAt:    new Date(),
      errorMessage:   null,
      decisionTrace:  recorder.serialize(),
      paymentTrace:   null,  // Phase 2
    }

    return { run, world, bus, recorder, tickSnapshots, durationMs }
  }
}

// src/app/api/runs/route.ts
// Runs Experiment 001 (deterministic engine), extracts metrics, runs the analyst, returns JSON.
// No database: results are returned to the browser (the engine is fast and seeded).
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { SimulationEngine } from '../../../simulation/engine'
import { EXPERIMENT_001 } from '../../../simulation/scenarios/stale-inventory'
import { extractMetrics } from '../../../analytics/metrics'
import { runAnalysis } from '../../../analytics/analyst'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { seed?: string; withInjection?: boolean }
  const seed = typeof body.seed === 'string' && body.seed ? body.seed.slice(0, 64) : 'wind-tunnel-001'
  const withInjection = body.withInjection ?? true
  const runId = randomUUID().replace(/-/g, '').slice(0, 12)

  const experiment = withInjection
    ? EXPERIMENT_001
    : { ...EXPERIMENT_001, scenarioConfig: { ...EXPERIMENT_001.scenarioConfig, injections: [] } }

  try {
    const result = await new SimulationEngine().execute({ experiment, runId, seed, paypalMode: 'simulated', mode: 'fresh' })
    const injectionTick = withInjection ? (EXPERIMENT_001.scenarioConfig.injections[0]?.atTick ?? null) : null
    const metrics = extractMetrics(result.bus, result.world, injectionTick)
    const buffer = result.bus.getBuffer()
    const analysis = await runAnalysis(metrics, buffer, runId)

    const events = buffer.map(e => ({
      id: e.id, tick: e.tick, type: e.type,
      agentId: e.agentId ?? null, merchantId: e.merchantId ?? null, orderId: e.orderId ?? null,
      payload: e.payload as unknown as Record<string, unknown>,
    }))

    return NextResponse.json({
      runId, status: 'completed', seed, withInjection, injectionTick,
      metrics,
      findings: analysis.findings,
      overallAssessment: analysis.overallAssessment,
      confidence: analysis.confidence,
      modelUsed: analysis.modelUsed,
      dataGaps: analysis.dataGaps,
      eventCount: result.bus.count,
      totalTicks: result.world.tick,
      events,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Simulation failed' }, { status: 500 })
  }
}

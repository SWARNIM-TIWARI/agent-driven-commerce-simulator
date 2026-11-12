// src/cli/simulate.ts

import { randomUUID } from 'crypto'
import { SimulationEngine } from '../simulation/engine'
import { EXPERIMENT_001 } from '../simulation/scenarios/stale-inventory'
import type { SimEvent } from '../events/types'
import type { AgentPhenotype } from '../domain/agent'
import { formatMoney } from '../domain/money'
import { writeFileSync, readFileSync, existsSync } from 'fs'

// ── ANSI color helpers ────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  blue:    '\x1b[34m',
  magenta: '\x1b[35m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  bgRed:   '\x1b[41m',
}

function c(color: keyof typeof C, s: string): string {
  return `${C[color]}${s}${C.reset}`
}

const PHENOTYPE_COLOR: Record<AgentPhenotype, keyof typeof C> = {
  budget_hunter:    'yellow',
  reliability_first: 'cyan',
  impatient:        'red',
  loyal:            'magenta',
  balanced:         'green',
}

function agentTag(name: string, phenotype: AgentPhenotype): string {
  return c(PHENOTYPE_COLOR[phenotype], name.padEnd(14))
}

// ── Event renderer ────────────────────────────────────────────

function renderEvent(event: SimEvent, world: WorldSnapshot): string | null {
  const tick = `[t=${String(event.tick).padStart(2, '0')}]`

  switch (event.type) {
    case 'INJECTION_APPLIED':
      return `${tick} ${c('bgRed', ' ⚡ INJECTION ')} ${c('bold', event.payload.injectionType)} → ${event.payload.targetMerchantId ?? 'system'}`

    case 'PRODUCT_SELECTED': {
      const agentId = event.agentId!
      const agent   = findAgentById(agentId, world)
      return `${tick} ${agentTag(agent?.name ?? agentId, agent?.phenotype ?? 'balanced')} ${c('blue', '→ SELECT')} ${event.payload.productName} ${c('dim', formatMoney(event.payload.price))} @ ${event.merchantId}`
    }

    case 'ORDER_FULFILLED': {
      const agentId = event.agentId!
      const agent   = findAgentById(agentId, world)
      return `${tick} ${agentTag(agent?.name ?? agentId, agent?.phenotype ?? 'balanced')} ${c('green', '✓ BUY')}    ${event.merchantId} ${c('green', formatMoney(event.payload.amount))}`
    }

    case 'ORDER_FULFILLMENT_FAILED':
    case 'ORDER_FAILED': {
      const agentId = event.agentId!
      const agent   = findAgentById(agentId, world)
      const reason  = 'failureCategory' in event.payload
        ? event.payload.failureCategory
        : event.payload.reason
      return `${tick} ${agentTag(agent?.name ?? agentId, agent?.phenotype ?? 'balanced')} ${c('red', '✗ FAIL')}   ${event.merchantId} ${c('dim', reason)}`
    }

    case 'MERCHANT_SWITCH_INITIATED': {
      const agentId = event.agentId!
      const agent   = findAgentById(agentId, world)
      return `${tick} ${agentTag(agent?.name ?? agentId, agent?.phenotype ?? 'balanced')} ${c('yellow', '⟳ SWITCH')} ${event.payload.fromMerchantId} → ${event.payload.toMerchantId} ${c('dim', `(${event.payload.reason})`)} `
    }

    case 'AGENT_ABANDONED': {
      const agentId = event.agentId!
      const agent   = findAgentById(agentId, world)
      return `${tick} ${agentTag(agent?.name ?? agentId, agent?.phenotype ?? 'balanced')} ${c('red', '⊘ ABANDON')} ${event.payload.reason} failures=${event.payload.totalFailures}`
    }

    case 'AGENT_COMPLETED': {
      const agentId = event.agentId!
      const agent   = findAgentById(agentId, world)
      return `${tick} ${agentTag(agent?.name ?? agentId, agent?.phenotype ?? 'balanced')} ${c('green', '★ DONE')}   bought ${event.payload.successfulPurchases} items, ${event.payload.totalFailures} fails, ${event.payload.merchantSwitchCount} switches`
    }

    default:
      return null
  }
}

// ── Summary renderer ──────────────────────────────────────────

function renderSummary(result: import('../simulation/engine').RunResult): void {
  const bus     = result.bus
  const world   = result.world
  const bar     = '═'.repeat(62)

  console.log(`\n${c('bold', bar)}`)
  console.log(`  ${c('bold', 'RUN COMPLETE')}  |  ${result.world.tick} ticks  |  ${result.durationMs}ms  |  ${bus.count} events`)
  console.log(c('bold', bar))

  // Commerce metrics
  const fulfilled   = bus.getByType('ORDER_FULFILLED').length
  const failed      = bus.getByType('ORDER_FAILED').length + bus.getByType('ORDER_FULFILLMENT_FAILED').length
  const abandoned   = bus.getByType('AGENT_ABANDONED').length
  const attempts    = fulfilled + failed
  const conversion  = attempts > 0 ? ((fulfilled / attempts) * 100).toFixed(1) : '0.0'

  console.log(`\n${c('bold', 'COMMERCE')}`)
  console.log(`  Attempts:    ${attempts.toString().padStart(4)}   Fulfilled: ${c('green', fulfilled.toString())}   Failed: ${c('red', failed.toString())}   Abandoned agents: ${abandoned}`)
  console.log(`  Conversion:  ${conversion}%`)

  // Per-agent summary
  console.log(`\n${c('bold', 'AGENTS')}`)
  for (const agent of world.getAgents()) {
    const state    = agent.state
    const outcome  = state.status === 'completed' ? c('green', 'DONE    ') : state.status === 'abandoned' ? c('red', 'ABANDONED') : c('yellow', 'ACTIVE  ')
    const switches = `switches=${state.merchantSwitchCount}`
    const fails    = `fails=${state.totalFailures}`
    const bought   = `bought=${state.successfulPurchases.length}/${agent.objective.quantity}`
    console.log(`  ${agentTag(agent.name, agent.phenotype)} ${outcome}  ${bought}  ${fails}  ${switches}`)
  }

  // Merchant demand post-injection
  const injTick = EXPERIMENT_001.scenarioConfig.injections[0]?.atTick ?? 0
  console.log(`\n${c('bold', 'DEMAND SHIFT')} (pre injection tick=${injTick} vs post)`)

  const preEvents  = bus.getByTickRange(1, injTick - 1).filter(e => e.type === 'ORDER_FULFILLED')
  const postEvents = bus.getByTickRange(injTick, 9999).filter(e => e.type === 'ORDER_FULFILLED')

  const merchantNames: Record<string, string> = {}
  for (const m of world.getMerchants()) merchantNames[m.id] = m.name

  for (const [mid, name] of Object.entries(merchantNames)) {
    const pre  = preEvents.filter(e => e.merchantId === mid).length
    const post = postEvents.filter(e => e.merchantId === mid).length
    const bar  = '█'.repeat(post)
    console.log(`  ${name.padEnd(14)} pre=${pre}  post=${c(post > pre ? 'yellow' : 'dim', post.toString())}  ${c('dim', bar)}`)
  }

  console.log(`\n${c('bold', bar)}\n`)
}

// ── Helpers ───────────────────────────────────────────────────

interface WorldSnapshot {
  agents: Array<{ id: string; name: string; phenotype: AgentPhenotype }>
}

function findAgentById(id: string, world: WorldSnapshot) {
  return world.agents.find(a => a.id === id)
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args      = process.argv.slice(2)
  const mode: 'fresh' | 'replay' = args.includes('--mode=replay') ? 'replay' : 'fresh'
  const seed      = 'wind-tunnel-001'
  const runId     = randomUUID().replace(/-/g, '').slice(0, 12)
  const traceFile = '.wt-trace.json'

  const bar = '═'.repeat(62)
  console.log(`\n${c('bold', bar)}`)
  console.log(`  ${c('cyan', 'COMMERCE WIND TUNNEL')} — ${EXPERIMENT_001.name}`)
  console.log(`  Seed: ${c('yellow', seed)}  |  Ticks: ${EXPERIMENT_001.scenarioConfig.totalTicks}  |  Mode: ${c(mode === 'replay' ? 'magenta' : 'blue', mode.toUpperCase())}`)
  console.log(c('bold', bar) + '\n')

  const engine = new SimulationEngine()

  // Build an agent name/phenotype map for rendering
  const worldSnapshot: WorldSnapshot = {
    agents: EXPERIMENT_001.worldConfig.agents.map(a => ({
      id: a.id, name: a.name, phenotype: a.phenotype,
    })),
  }

  const config = {
    experiment: EXPERIMENT_001,
    runId,
    seed,
    paypalMode: 'simulated' as const,
    mode,
  }

  // Print events live
  // We'll capture output during the run using the event bus listener approach
  // Engine runs synchronously per tick, so we print after each event
  const liveEvents: SimEvent[] = []

  // Note: in Phase 1 we print events AFTER the run from the buffer
  // (engine is async but effectively synchronous in heuristic mode)
  const result = await engine.execute(config)

  // Print event trace
  for (const event of result.bus.getBuffer()) {
    const line = renderEvent(event, worldSnapshot)
    if (line) console.log(line)
  }

  // Print summary
  renderSummary(result)

  // Save trace for replay
  if (mode === 'fresh') {
    const trace = {
      runId,
      seed,
      experimentId:   EXPERIMENT_001.id,
      decisionTrace:  result.run.decisionTrace,
      tickSnapshots:  Object.fromEntries(result.tickSnapshots),
    }
    writeFileSync(traceFile, JSON.stringify(trace, null, 2))
    console.log(`${c('dim', `Trace saved to ${traceFile} — run with --mode=replay to verify reproducibility`)}\n`)
  }
}

main().catch(err => {
  console.error(c('red', `Fatal error: ${err.message}`))
  console.error(err.stack)
  process.exit(1)
})

// src/analytics/analyst.ts
import type { RunMetrics } from './types'
import type { SimEvent } from '../events/types'
import type { Finding, FindingType, FindingSeverity } from '../domain/finding'
import { randomUUID } from 'crypto'

export interface AnalystOutput {
  findings:          Finding[]
  overallAssessment: string
  confidence:        'high' | 'medium' | 'low' | 'insufficient_data'
  dataGaps:          string[]
  modelUsed:         'groq' | 'deterministic'
}

interface EvidenceIndex {
  [eventId: string]: { id: string; type: string; tick: number; summary: string }
}

/**
 * One LLM call post-run. Receives a compact evidence bundle.
 * Uses Groq when GROQ_API_KEY is set; otherwise (or on any error) a clearly labelled deterministic analysis.
 * Validates every cited eventId against the evidence index before persisting.
 */
export async function runAnalysis(
  metrics: RunMetrics,
  events:  readonly SimEvent[],
  runId:   string,
): Promise<AnalystOutput> {

  const evidenceIndex = buildEvidenceIndex(events)
  const bundle        = buildAnalystBundle(metrics, events, evidenceIndex)

  // Optional LLM analyst (Groq, OpenAI-compatible API). Any failure falls back to the deterministic analyst.
  if (process.env.GROQ_API_KEY) {
    try {
      return await callGroq(bundle, evidenceIndex, runId)
    } catch (e) {
      console.warn('[Analyst] Groq call failed, using deterministic fallback:', e instanceof Error ? e.message : e)
    }
  }

  // Deterministic fallback — always works, always honest
  return deterministicAnalysis(metrics, events, evidenceIndex, runId)
}

// ── Evidence construction ─────────────────────────────────────

function buildEvidenceIndex(events: readonly SimEvent[]): EvidenceIndex {
  const idx: EvidenceIndex = {}
  const SIGNIFICANT: Set<string> = new Set([
    'INJECTION_APPLIED', 'AGENT_ABANDONED', 'AGENT_COMPLETED',
    'MERCHANT_SWITCH_INITIATED', 'ORDER_FULFILLMENT_FAILED',
    'ORDER_FULFILLED', 'INVENTORY_DEPLETED', 'AGENT_DECISION_MADE',
  ])
  for (const e of events) {
    if (SIGNIFICANT.has(e.type)) {
      idx[e.id] = {
        id:      e.id,
        type:    e.type,
        tick:    e.tick,
        summary: summariseEvent(e),
      }
    }
  }
  return idx
}

function summariseEvent(e: SimEvent): string {
  switch (e.type) {
    case 'INJECTION_APPLIED':          return `Injection ${e.payload.injectionType} applied to ${e.payload.targetMerchantId} at tick ${e.tick}`
    case 'AGENT_ABANDONED':            return `Agent (${e.payload.phenotype}) abandoned at tick ${e.tick}: ${e.payload.reason}, failures=${e.payload.totalFailures}`
    case 'MERCHANT_SWITCH_INITIATED':  return `Agent (${e.payload.phenotype}) switched from ${e.payload.fromMerchantId} to ${e.payload.toMerchantId} at tick ${e.tick}: ${e.payload.reason}`
    case 'ORDER_FULFILLMENT_FAILED':   return `Fulfillment failed at ${e.merchantId} tick ${e.tick}: ${e.payload.reason}`
    case 'ORDER_FULFILLED':            return `Order fulfilled at ${e.merchantId} tick ${e.tick}`
    case 'AGENT_COMPLETED':            return `Agent (${e.payload.phenotype}) completed at tick ${e.tick}: ${e.payload.successfulPurchases} purchases, ${e.payload.totalFailures} failures`
    case 'INVENTORY_DEPLETED':         return `Inventory depleted: ${e.payload.productName} at tick ${e.tick}`
    default:                           return `${e.type} at tick ${e.tick}`
  }
}

function buildAnalystBundle(
  metrics: RunMetrics,
  events:  readonly SimEvent[],
  idx:     EvidenceIndex,
): object {
  const inj = metrics.injectionTick

  return {
    experiment: { injectionTick: inj, totalTicks: Math.max(...events.map(e => e.tick), 0) },
    commerce: {
      conversionRate:    (metrics.commerce.conversionRate * 100).toFixed(1) + '%',
      totalAttempts:     metrics.commerce.totalPurchaseAttempts,
      totalFulfilled:    metrics.commerce.successfulPurchases,
      totalFailed:       metrics.commerce.failedPurchases,
      abandonedAgents:   metrics.commerce.abandonments,
    },
    demandShift: {
      preHHI:                metrics.system.demandConcentration.preInjectionHerfindahlIndex.toFixed(3),
      postHHI:               metrics.system.demandConcentration.postInjectionHerfindahlIndex.toFixed(3),
      concentrationIncrease: metrics.system.demandConcentration.concentrationIncrease.toFixed(3),
      dominantMerchantPost:  metrics.system.demandConcentration.dominantMerchantIdPost,
    },
    migration: {
      totalSwitches:     metrics.system.migrationIntensity.totalMerchantSwitches,
      migrationPeakTick: metrics.system.migrationIntensity.migrationPeakTick,
      primarySource:     Object.entries(metrics.system.migrationIntensity.fromMerchant).sort((a, b) => b[1] - a[1])[0]?.[0],
      primaryDest:       Object.entries(metrics.system.migrationIntensity.toMerchant).sort((a, b) => b[1] - a[1])[0]?.[0],
    },
    agentsByphenotype: Object.fromEntries(
      Object.entries(metrics.agentBehavior.byPhenotype).map(([k, v]) => [k, {
        avgRetries:         v.avgRetries.toFixed(1),
        avgSwitches:        v.avgMerchantSwitches.toFixed(1),
        recoveryRate:       (v.recoveryRate * 100).toFixed(0) + '%',
        avgRecoveryTicks:   v.avgTimeToRecovery?.toFixed(1) ?? 'N/A',
        abandonmentRate:    (v.abandonmentRate * 100).toFixed(0) + '%',
      }])
    ),
    failureCluster: {
      startTick:     metrics.system.failureCluster.failureStartTick,
      peakTick:      metrics.system.failureCluster.failurePeakTick,
      durationTicks: metrics.system.failureCluster.failureDurationTicks,
      totalFailures: metrics.system.failureCluster.totalFailures,
    },
    evidenceIndex: Object.fromEntries(Object.entries(idx).slice(0, 40)),  // cap tokens
  }
}

// ── LLM providers ─────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an analytics engine for an autonomous commerce experiment.

You receive a structured evidence bundle from a simulation run. Your task is to identify what actually happened and explain it.

STRICT RULES:
1. Every finding MUST cite at least one eventId from the evidenceIndex. If you cannot cite evidence, do not report the finding.
2. Use finding types: observed_pattern | system_effect | hypothesis | impact | intervention
3. Use severities: info | notable | significant | critical  
4. You may NOT claim causal proof. You may say "evidence is consistent with" or "observed pattern suggests".
5. If evidence is insufficient, set confidence = "insufficient_data" and findings = [].
6. dataGaps should list what you could not determine.

Respond with valid JSON matching this schema exactly:
{
  "findings": [
    {
      "type": "observed_pattern",
      "severity": "significant",
      "title": "short title",
      "description": "2-3 sentences citing evidence",
      "eventIds": ["evt_..."],
      "suggestedIntervention": "optional intervention"
    }
  ],
  "overallAssessment": "2-3 sentence summary of what this run showed",
  "confidence": "high|medium|low|insufficient_data",
  "dataGaps": ["list of things that could not be determined"]
}`

const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile'

async function callGroq(bundle: object, idx: EvidenceIndex, runId: string): Promise<AnalystOutput> {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model:           GROQ_MODEL,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: JSON.stringify(bundle) },
      ],
    }),
  })
  if (!resp.ok) throw new Error(`Groq HTTP ${resp.status}`)
  const data    = await resp.json() as { choices: Array<{ message: { content: string } }> }
  const content = data.choices[0]?.message.content ?? '{}'
  return parseAndValidateLLMOutput(content, idx, runId, 'groq')
}

function parseAndValidateLLMOutput(
  content:   string,
  idx:       EvidenceIndex,
  runId:     string,
  modelUsed: 'groq',
): AnalystOutput {
  let parsed: {
    findings: Array<{ type: string; severity: string; title: string; description: string; eventIds: string[]; suggestedIntervention?: string }>
    overallAssessment: string
    confidence: string
    dataGaps: string[]
  }

  try {
    // Extract JSON from possible markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? [null, content]
    parsed = JSON.parse(jsonMatch[1] ?? content)
  } catch {
    throw new Error('LLM returned invalid JSON')
  }

  const now = new Date()
  const findings: Finding[] = (parsed.findings ?? [])
    .filter(f => Array.isArray(f.eventIds) && f.eventIds.some(id => id in idx))
    .map(f => ({
      id:                    randomUUID(),
      runId,
      type:                  (f.type as FindingType) ?? 'observed_pattern',
      severity:              (f.severity as FindingSeverity) ?? 'notable',
      title:                 f.title ?? 'Unnamed finding',
      description:           f.description ?? '',
      evidence:              [{ description: f.description ?? '', eventIds: f.eventIds.filter(id => id in idx) }],
      suggestedIntervention: f.suggestedIntervention ?? null,
      generatedAt:           now,
    }))

  return {
    findings,
    overallAssessment: parsed.overallAssessment ?? '',
    confidence:        (parsed.confidence as AnalystOutput['confidence']) ?? 'low',
    dataGaps:          parsed.dataGaps ?? [],
    modelUsed,
  }
}

// ── Deterministic fallback ────────────────────────────────────

function deterministicAnalysis(
  metrics: RunMetrics,
  events:  readonly SimEvent[],
  idx:     EvidenceIndex,
  runId:   string,
): AnalystOutput {
  const findings: Finding[] = []
  const now  = new Date()
  const inj  = metrics.injectionTick
  const hhi  = metrics.system.demandConcentration

  // Finding 1: demand concentration increased
  if (hhi.concentrationIncrease > 0.1) {
    const switchEvts = Object.keys(idx).filter(id => idx[id]!.type === 'MERCHANT_SWITCH_INITIATED').slice(0, 5)
    if (switchEvts.length > 0) {
      findings.push({
        id:          randomUUID(),
        runId,
        type:        'system_effect',
        severity:    hhi.concentrationIncrease > 0.3 ? 'critical' : 'significant',
        title:       'Demand concentrated after primary merchant failure',
        description: `Post-injection HHI rose from ${hhi.preInjectionHerfindahlIndex.toFixed(2)} to ${hhi.postInjectionHerfindahlIndex.toFixed(2)} (Δ${hhi.concentrationIncrease.toFixed(2)}). Post-injection demand was most concentrated at ${hhi.dominantMerchantIdPost}. This concentration was not caused by any individual agent — it emerged from the simultaneous adaptation of ${Object.keys(metrics.agentBehavior.byAgent).length} independent buyers.`,
        evidence:    [{ description: 'Merchant switches following injection', eventIds: switchEvts }],
        suggestedIntervention: 'Increase secondary merchant inventory depth to absorb demand migration.',
        generatedAt: now,
      })
    }
  }

  // Finding 2: phenotype divergence
  const phenoMetrics = Object.values(metrics.agentBehavior.byPhenotype)
  const maxSwitches  = Math.max(...phenoMetrics.map(p => p.avgMerchantSwitches))
  const minSwitches  = Math.min(...phenoMetrics.map(p => p.avgMerchantSwitches))
  if (maxSwitches - minSwitches >= 1) {
    const completedEvts = Object.keys(idx).filter(id => idx[id]!.type === 'AGENT_COMPLETED').slice(0, 3)
    if (completedEvts.length > 0) {
      findings.push({
        id:          randomUUID(),
        runId,
        type:        'observed_pattern',
        severity:    'significant',
        title:       'Agent phenotypes produced measurably different recovery strategies',
        description: `Merchant switch counts ranged from ${minSwitches.toFixed(1)} to ${maxSwitches.toFixed(1)} across phenotypes. Evidence is consistent with the hypothesis that policy parameters (retryTolerance, riskTolerance) directly determine post-failure adaptation speed. Impatient agents switched faster; loyal agents absorbed more failures before switching.`,
        evidence:    [{ description: 'Agent completion events by phenotype', eventIds: completedEvts }],
        suggestedIntervention: null,
        generatedAt: now,
      })
    }
  }

  // Finding 3: secondary merchant pressure
  const secondaryDepletion = Object.entries(metrics.system.inventoryDepletionByMerchant)
    .filter(([id]) => id !== metrics.system.failureCluster.primaryFailedMerchantId)
    .filter(([, d]) => d > 0.4)
  if (inj && secondaryDepletion.length > 0) {
    const deplEvts = Object.keys(idx).filter(id => idx[id]!.type === 'INVENTORY_DEPLETED').slice(0, 3)
    findings.push({
      id:          randomUUID(),
      runId,
      type:        'hypothesis',
      severity:    'notable',
      title:       'Secondary merchants experienced unusual inventory pressure post-injection',
      description: `${secondaryDepletion.map(([id]) => id).join(', ')} each depleted >40% of inventory after tick ${inj}. This is consistent with migration-driven demand concentration. A single run cannot confirm causation, but the timing and volume are consistent with the hypothesis that primary merchant failure created secondary stress.`,
      evidence:    deplEvts.length > 0 ? [{ description: 'Inventory depletion events', eventIds: deplEvts }] : [],
      suggestedIntervention: 'Run a control experiment (no injection) with the same seed to isolate the migration effect.',
      generatedAt: now,
    })
  }

  const assessment = findings.length > 0
    ? `The injection at tick ${inj} produced ${metrics.system.migrationIntensity.totalMerchantSwitches} merchant switches and a ${(hhi.concentrationIncrease * 100).toFixed(0)}% increase in demand concentration. No individual agent caused the system-level effect — it emerged from ${Object.keys(metrics.agentBehavior.byAgent).length} agents each responding rationally to their own local failures.`
    : `Experiment produced ${metrics.commerce.totalPurchaseAttempts} purchase attempts with ${(metrics.commerce.conversionRate * 100).toFixed(1)}% conversion. Insufficient evidence to report behavioral patterns.`

  return {
    findings,
    overallAssessment: assessment,
    confidence:        findings.length >= 2 ? 'medium' : findings.length === 1 ? 'low' : 'insufficient_data',
    dataGaps:          ['Control run (no injection) required for causal claims', 'Single seed — multi-seed sweep needed for statistical confidence'],
    modelUsed:         'deterministic',
  }
}

'use client'
import { useMemo, useState } from 'react'
import type { SandboxEventView } from './types'
import { AGENTS, MERCHANTS, KIND_COLOR, agentStateAt, evidenceIds, kindOf, sumLoad, type EventKind, type Finding, type LabEvent, type RunResult } from '../lib/lab'

// ── Metrics ───────────────────────────────────────────────────

function Spark({ series, color }: { series: number[]; color: string }) {
  const max = Math.max(1, ...series)
  const pts = series.map((v, i) => `${(i / Math.max(1, series.length - 1)) * 100},${28 - (v / max) * 26}`).join(' ')
  return <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="spark" aria-hidden="true"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" /></svg>
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string | undefined; tone?: 'good' | 'bad' | 'warn' | undefined }) {
  return <div className={`tile ${tone ? `tile-${tone}` : ''}`}><div className="tile-l">{label}</div><div className="tile-v">{value}</div>{sub && <div className="tile-s">{sub}</div>}</div>
}

export function Metrics({ result, control }: { result: RunResult; control: RunResult | null }) {
  const c = result.metrics.commerce
  const dc = result.metrics.system.demandConcentration
  const load = result.metrics.system.merchantLoadByTick
  const failByType = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of result.events ?? []) if (kindOf(e.type) === 'fail') m.set(e.type, (m.get(e.type) ?? 0) + 1)
    return [...m.entries()]
  }, [result.events])
  const delta = control ? c.conversionRate - control.metrics.commerce.conversionRate : null
  return (
    <>
      <div className="tiles">
        <Tile label="Conversion" value={`${(c.conversionRate * 100).toFixed(1)}%`} sub={delta === null ? undefined : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} pts vs control`} tone={delta !== null && delta < 0 ? 'bad' : 'good'} />
        <Tile label="Attempts" value={String(c.totalPurchaseAttempts)} />
        <Tile label="Fulfilled" value={String(c.successfulPurchases)} tone="good" />
        <Tile label="Failed" value={String(c.failedPurchases)} tone={c.failedPurchases ? 'bad' : undefined} />
        <Tile label="Merchant switches" value={String(result.metrics.system.migrationIntensity.totalMerchantSwitches)} tone="warn" />
        <Tile label="Demand HHI" value={`${dc.preInjectionHerfindahlIndex.toFixed(2)} → ${dc.postInjectionHerfindahlIndex.toFixed(2)}`} sub="before → after injection tick" />
        <Tile label="Abandonments" value={String(c.abandonments)} tone={c.abandonments ? 'bad' : undefined} />
        <Tile label="Failure types" value={failByType.length ? String(failByType.length) : '0'} sub={failByType.map(([t, n]) => `${t.replace(/_/g, ' ').toLowerCase()} ×${n}`).join(' · ') || 'none recorded'} />
      </div>
      <div className="trend" role="group" aria-label="Orders per tick by merchant">
        <div className="trend-h">Orders per tick, by merchant <span className="dim">(engine data)</span></div>
        <div className="trend-rows">
          {MERCHANTS.map(m => (
            <div key={m.id} className="trend-row"><span style={{ color: m.color }}>{m.name}</span><Spark series={load[m.id] ?? []} color={m.color} /><b>{sumLoad(load, m.id)}</b></div>
          ))}
        </div>
      </div>
    </>
  )
}

// ── Agents ────────────────────────────────────────────────────

export function AgentCards({ result, tick }: { result: RunResult; tick: number }) {
  const st = useMemo(() => agentStateAt(result.events ?? [], tick), [result.events, tick])
  return (
    <div className="agents">
      {AGENTS.map(a => {
        const s = st[a.id]!; const d = result.metrics.agentBehavior.byAgent[a.id]
        const m = MERCHANTS.find(x => x.id === s.merchantId)
        return (
          <article key={a.id} className="agent" style={{ ['--c' as string]: a.color }}>
            <div className="agent-top"><span className="agent-g" aria-hidden="true">{a.glyph}</span><div><h4>{a.name}</h4><span className="mono dim">{a.phenotype}</span></div></div>
            <dl className="agent-stats">
              <div><dt>Now at</dt><dd>{m?.name ?? '—'}</dd></div>
              <div><dt>Status</dt><dd><span className={`pill pill-${s.status}`}>{s.status}</span></dd></div>
              <div><dt>Purchases</dt><dd>{s.fulfilled}</dd></div>
              <div><dt>Failures</dt><dd>{s.failures}</dd></div>
              <div><dt>Switches</dt><dd>{s.switches}{d ? <span className="dim"> / {d.merchantSwitches} total</span> : null}</dd></div>
              <div><dt>Final</dt><dd>{d ? (d.abandoned ? 'abandoned' : 'completed') : '—'}</dd></div>
            </dl>
          </article>
        )
      })}
      <p className="fine agents-note">Status, merchant and counts are computed from recorded events up to tick {tick}.</p>
    </div>
  )
}

// ── Analyst ───────────────────────────────────────────────────

const SEV: Record<string, string> = { critical: '#F87171', significant: '#FBBF24', notable: '#60A5FA', info: '#9CA3AF' }

export function FindingCard({ f, onEvidence }: { f: Finding; onEvidence: (id: string) => void }) {
  const ids = evidenceIds(f.evidence)
  const color = SEV[f.severity] ?? '#9CA3AF'
  return (
    <article className="finding" style={{ ['--c' as string]: color }}>
      <header>
        <span className="chip" style={{ borderColor: color, color }}>{f.type.replace(/_/g, ' ')}</span>
        <span className="chip chip-plain">{f.severity}</span>
        {f.confidence !== undefined && <span className="chip chip-plain">confidence {String(f.confidence)}</span>}
        <span className={`chip ${ids.length ? 'chip-obs' : 'chip-hyp'}`}>{ids.length ? `OBSERVATION · cites ${ids.length} event${ids.length > 1 ? 's' : ''}` : 'HYPOTHESIS · no cited events'}</span>
      </header>
      <h4>{f.title}</h4>
      <p>{f.description}</p>
      {ids.length > 0 && (
        <p className="ev"><span className="dim">Evidence:</span> {ids.slice(0, 8).map(id => <button key={id} className="evid mono" onClick={() => onEvidence(id)}>{id.slice(0, 14)}</button>)}{ids.length > 8 && <span className="dim"> +{ids.length - 8} more</span>}</p>
      )}
      {f.suggestedIntervention && <p className="sugg"><b>Suggested intervention</b> {f.suggestedIntervention}</p>}
    </article>
  )
}

// ── Event stream ──────────────────────────────────────────────

const KINDS: EventKind[] = ['attempt', 'success', 'fail', 'switch', 'abandon', 'injection']

export function EventStream({ events, tick, sandbox, highlightId }: { events: LabEvent[]; tick: number; sandbox: SandboxEventView[]; highlightId: string | null }) {
  const [kinds, setKinds] = useState<Set<EventKind>>(new Set(KINDS))
  const [agent, setAgent] = useState('all')
  const [follow, setFollow] = useState(true)
  const shown = useMemo(() => {
    const f = events.filter(e => (!follow || e.tick <= tick) && kinds.has(kindOf(e.type)) && (agent === 'all' || e.agentId === agent))
    return f.slice(-150).reverse()
  }, [events, tick, kinds, agent, follow])
  const toggle = (k: EventKind) => setKinds(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  return (
    <div className="es">
      <div className="es-filters" role="group" aria-label="Event filters">
        {KINDS.map(k => <button key={k} className={`fchip ${kinds.has(k) ? 'fchip-on' : ''}`} aria-pressed={kinds.has(k)} onClick={() => toggle(k)} style={{ ['--c' as string]: KIND_COLOR[k] }}>{k}</button>)}
        <select value={agent} onChange={e => setAgent(e.target.value)} aria-label="Filter by agent"><option value="all">all agents</option>{AGENTS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <label className="chk"><input type="checkbox" checked={follow} onChange={e => setFollow(e.target.checked)} /> follow playback</label>
      </div>

      {sandbox.length > 0 && (
        <ul className="es-list es-real" aria-label="Real PayPal Sandbox events">
          {[...sandbox].reverse().map(e => (
            <li key={e.id}><span className="badge badge-sbx">REAL · SANDBOX</span><span className="es-type">{e.type.replace('PAYPAL_', '')}</span><span className="mono dim">{e.orderId}</span><span className="dim">{new Date(e.at).toLocaleTimeString()}</span></li>
          ))}
        </ul>
      )}

      <ul className="es-list" aria-label="Simulated experiment events">
        {shown.length === 0 && <li className="dim">No events match the filters yet.</li>}
        {shown.map(e => {
          const k = kindOf(e.type); const a = AGENTS.find(x => x.id === e.agentId); const m = MERCHANTS.find(x => x.id === e.merchantId)
          return (
            <li key={e.id} id={`ev-${e.id}`} className={e.id === highlightId ? 'hl' : ''}>
              <span className="badge badge-sim">SIMULATED</span>
              <span className="mono dim">t{String(e.tick).padStart(2, '0')}</span>
              <span className="dot" style={{ background: KIND_COLOR[k] }} aria-hidden="true" />
              <span className="es-type">{e.type.replace(/_/g, ' ').toLowerCase()}</span>
              <span style={{ color: a?.color }}>{a?.name ?? ''}</span>
              <span style={{ color: m?.color }}>{m ? `→ ${m.name}` : ''}</span>
              <span className="mono dim es-id">{e.id.slice(0, 12)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── Comparison ────────────────────────────────────────────────

export function Compare({ experiment, control }: { experiment: RunResult; control: RunResult }) {
  const rows = MERCHANTS.map(m => ({ m, e: sumLoad(experiment.metrics.system.merchantLoadByTick, m.id), c: sumLoad(control.metrics.system.merchantLoadByTick, m.id) }))
  const max = Math.max(1, ...rows.flatMap(r => [r.e, r.c]))
  const ce = experiment.metrics.commerce, cc = control.metrics.commerce
  return (
    <div className="cmp">
      <p className="muted">Same seed <span className="mono">{experiment.seed ?? 'wind-tunnel-001'}</span>. <b>Control</b> = no failure injected. <b>Experiment</b> = stale inventory injected. Both are simulated runs.</p>
      <div className="cmp-grid">
        {rows.map(({ m, e, c }) => (
          <div key={m.id} className="cmp-card">
            <h4 style={{ color: m.color }}>{m.name}</h4>
            <div className="bars" role="img" aria-label={`${m.name} orders: control ${c}, experiment ${e}`}>
              <div className="bar-row"><span>Control</span><i style={{ width: `${(c / max) * 100}%`, background: '#6B7280' }} /><b>{c}</b></div>
              <div className="bar-row"><span>Experiment</span><i style={{ width: `${(e / max) * 100}%`, background: m.color }} /><b>{e}</b></div>
            </div>
            <div className={e - c >= 0 ? 'up' : 'down'}>{e - c >= 0 ? '▲' : '▼'} {Math.abs(e - c)} orders vs control</div>
          </div>
        ))}
      </div>
      <table className="cmp-table">
        <thead><tr><th>Metric</th><th>Control</th><th>Experiment</th></tr></thead>
        <tbody>
          <tr><td>Conversion</td><td>{(cc.conversionRate * 100).toFixed(1)}%</td><td>{(ce.conversionRate * 100).toFixed(1)}%</td></tr>
          <tr><td>Failed purchases</td><td>{cc.failedPurchases}</td><td>{ce.failedPurchases}</td></tr>
          <tr><td>Merchant switches</td><td>{control.metrics.system.migrationIntensity.totalMerchantSwitches}</td><td>{experiment.metrics.system.migrationIntensity.totalMerchantSwitches}</td></tr>
          <tr><td>Abandonments</td><td>{cc.abandonments}</td><td>{ce.abandonments}</td></tr>
        </tbody>
      </table>
    </div>
  )
}

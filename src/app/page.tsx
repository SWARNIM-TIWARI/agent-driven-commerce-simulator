'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { NetworkStage, PlaybackBar, usePlayback } from '../components/NetworkStage'
import { AgentCards, Compare, EventStream, FindingCard, Metrics } from '../components/LabPanels'
import { PayPalProof } from '../components/PayPalProof'
import { useReveal } from '../components/useReveal'
import type { SandboxEventView } from '../components/types'
import type { RunResult } from '../lib/lab'

const SEED = 'wind-tunnel-001'

export default function Home() {
  const [result, setResult] = useState<RunResult | null>(null)
  const [control, setControl] = useState<RunResult | null>(null)
  const [running, setRunning] = useState<null | 'experiment' | 'control'>(null)
  const [error, setError] = useState<string | null>(null)
  const [sandbox, setSandbox] = useState<SandboxEventView[]>([])
  const [hl, setHl] = useState<string | null>(null)
  const heroVis = useRef<HTMLDivElement>(null)
  useReveal([result, control])

  const total = result?.totalTicks ?? 60
  const pb = usePlayback(total)
  const events = result?.events ?? []
  const injectionTick = result ? (result.withInjection === false ? null : result.injectionTick ?? 20) : 20

  // parallax (skipped under reduced motion)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const on = () => { if (heroVis.current) heroVis.current.style.transform = `translate3d(0, ${Math.min(window.scrollY, 700) * 0.18}px, 0)` }
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  const refreshSandbox = useCallback(() => {
    fetch('/api/paypal/events').then(r => r.json()).then((j: { events: SandboxEventView[] }) => setSandbox(j.events)).catch(() => undefined)
  }, [])
  useEffect(refreshSandbox, [refreshSandbox])

  const run = useCallback(async (withInjection: boolean) => {
    setRunning(withInjection ? 'experiment' : 'control'); setError(null)
    if (withInjection) { setResult(null); setControl(null); pb.reset() }
    try {
      const resp = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: SEED, paypalMode: 'simulated', withInjection }) })
      const data = (await resp.json()) as RunResult & { error?: string }
      if (!resp.ok) throw new Error(data.error ?? `HTTP ${resp.status}`)
      if (withInjection) { setResult({ ...data, withInjection: true }); pb.start() } else setControl({ ...data, withInjection: false })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setRunning(null) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runAndScroll = async () => { document.getElementById('lab')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); await run(true) }
  const jump = (id: string) => { setHl(id); document.getElementById(`ev-${id}`)?.scrollIntoView({ block: 'center' }) }
  const reset = () => { setResult(null); setControl(null); pb.reset(); setError(null) }
  const status = running ? `running ${running}` : result ? 'completed' : 'idle'
  const stageProps = { events, tick: pb.tick, nonce: pb.nonce, injectionTick, hasRun: !!result, runId: result?.runId }

  return (
    <>
      {/* ───────── HERO ───────── */}
      <section className="hero" aria-labelledby="h1">
        <div className="hero-vis" ref={heroVis} aria-hidden={false}>
          <NetworkStage variant="hero" {...stageProps} />
        </div>
        <div className="hero-copy">
          <p className="eyebrow">PayPal AI Hackathon 2026 · Experiment 001 · Stale Inventory</p>
          <h1 id="h1" className="display">Test the economy <span className="outline">before it runs itself</span></h1>
          <p className="lead">Five autonomous buyers. Three merchants. One hidden inventory failure. What emerges?</p>
          <div className="cta">
            <button className="btn btn-primary btn-xl" onClick={runAndScroll} disabled={!!running}>{running === 'experiment' ? 'Running…' : '▶ Run Experiment'}</button>
            <a className="btn btn-ghost btn-xl" href="#paypal">PayPal Sandbox proof ↓</a>
          </div>
        </div>
        <a className="scroll-cue" href="#features" aria-label="Scroll to the experiment overview"><span>Scroll</span><i aria-hidden="true" /></a>
      </section>

      {/* ───────── FEATURES ───────── */}
      <section id="features" className="features" data-reveal>
        <div><span className="index" aria-hidden="true">01</span><h2>Five autonomous buyers</h2><p>Budget hunter, reliability-first, impatient, loyal and balanced — each decides differently from the same evidence.</p></div>
        <div><span className="index" aria-hidden="true">02</span><h2>Three merchants</h2><p>AlphaShop, BetaMart and GammaStore compete for the same demand while PayPal carries every transaction.</p></div>
        <div><span className="index" aria-hidden="true">03</span><h2>One hidden failure</h2><p>The stale inventory injection fires at tick 20. We measure what emerges, then an analyst cites the evidence.</p></div>
      </section>

      {/* ───────── LAB ───────── */}
      <section id="lab" className="lab">
        <header className="labbar">
          <div className="labbar-id"><span className="logo" aria-hidden="true" /><div><b>PayPal Commerce Wind Tunnel</b><span className="dim">Experiment 001 · Stale Inventory</span></div></div>
          <dl className="labbar-meta">
            <div><dt>Status</dt><dd><span className={`pill pill-${running ? 'transacting' : result ? 'completed' : 'idle'}`}>{status}</span></dd></div>
            <div><dt>Seed</dt><dd className="mono">{SEED}</dd></div>
            <div><dt>Run ID</dt><dd className="mono">{result?.runId ?? '—'}</dd></div>
          </dl>
          <div className="labbar-actions">
            <button className="btn btn-primary" onClick={() => run(true)} disabled={!!running}>{running === 'experiment' ? 'Running…' : '▶ Run'}</button>
            <button className="btn btn-ghost" onClick={() => run(false)} disabled={!!running || !result}>{running === 'control' ? 'Running…' : 'Run control'}</button>
            <button className="btn btn-ghost" onClick={reset} disabled={!!running || !result}>Reset</button>
          </div>
        </header>

        {error && <div className="callout callout-bad" role="alert">✗ {error}</div>}

        {!result && !running && <div className="empty" data-reveal><p><b>Press Run.</b> The engine executes Experiment 001, then replays its recorded events through the network below.</p></div>}
        {running === 'experiment' && <div className="empty" role="status">Running the simulation, metrics and analyst…</div>}

        {result && (
          <>
            <div className="panel panel-wide" data-reveal>
              <h2 className="ph">Commerce network</h2>
              {events.length === 0 && <div className="callout">The run API did not return <code>events</code>, so playback is unavailable. Apply the small <code>/api/runs</code> patch (see handoff notes).</div>}
              <NetworkStage variant="lab" {...stageProps} />
              <PlaybackBar totalTicks={total} tick={pb.tick} playing={pb.playing} speed={pb.speed} injectionTick={injectionTick} runId={result.runId} eventCount={result.eventCount} onToggle={pb.toggle} onSeek={pb.seek} onSpeed={pb.setSpeed} />
            </div>

            <div className="panel" data-reveal><h2 className="ph">Metrics</h2><Metrics result={result} control={control} /></div>
            <div className="panel" data-reveal><h2 className="ph">Agents</h2><AgentCards result={result} tick={pb.tick} /></div>

            <div className="panel" data-reveal>
              <h2 className="ph">AI analyst <span className="badge badge-sim" title="Which model produced these findings">{result.modelUsed}</span> <span className="dim">overall confidence: {result.confidence}</span></h2>
              {result.overallAssessment && <p className="muted">{result.overallAssessment}</p>}
              {result.findings.length === 0 && <p className="muted">No findings with sufficient evidence.</p>}
              <div className="findings">{result.findings.map(f => <FindingCard key={f.id} f={f} onEvidence={jump} />)}</div>
            </div>

            <div className="panel" data-reveal><h2 className="ph">Event stream</h2><EventStream events={events} tick={pb.tick} sandbox={sandbox} highlightId={hl} /></div>

            <div className="panel panel-wide" data-reveal>
              <h2 className="ph">Experiment vs control</h2>
              {control ? <Compare experiment={result} control={control} /> : <p className="muted">Run the control (same seed, no injection) to compare.</p>}
            </div>
          </>
        )}

        <div id="paypal" className="panel panel-wide panel-sbx" data-reveal>
          <PayPalProof onChange={refreshSandbox} />
        </div>

        <footer className="foot">Simulated agents use <b>SimulatedPaymentProvider</b>. Only the panel above talks to PayPal, and only the Sandbox. · <a href="https://developer.paypal.com/dashboard/sandbox/" target="_blank" rel="noreferrer">PayPal Sandbox dashboard ↗</a></footer>
      </section>
    </>
  )
}

'use client'
// The centrepiece. Every moving element is driven by a recorded engine event; nothing is invented.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AGENTS, MERCHANTS, agentStateAt, kindOf, tallyUpTo, KIND_COLOR, type LabEvent, type MerchantDef } from '../lib/lab'

export function usePlayback(totalTicks: number) {
  const [tick, setTick] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [nonce, setNonce] = useState(0) // restarts CSS pulses when the same tick is revisited
  const ref = useRef({ tick, totalTicks })
  ref.current = { tick, totalTicks }

  useEffect(() => {
    if (!playing) return
    const id = window.setInterval(() => {
      const { tick: t, totalTicks: total } = ref.current
      if (t >= total) { setPlaying(false); return }
      setTick(t + 1)
      setNonce(n => n + 1)
    }, 450 / speed)
    return () => window.clearInterval(id)
  }, [playing, speed])

  return {
    tick, playing, speed, nonce,
    setSpeed,
    seek: (t: number) => { setPlaying(false); setTick(Math.max(0, Math.min(totalTicks, t))); setNonce(n => n + 1) },
    toggle: () => { if (ref.current.tick >= ref.current.totalTicks) { setTick(0) } setPlaying(p => !p) },
    start: () => { setTick(0); setNonce(n => n + 1); setPlaying(true) },
    reset: () => { setTick(0); setPlaying(false) },
  }
}

function shapePath(m: MerchantDef, r: number): string {
  const { x, y } = m
  if (m.shape === 'diamond') return `M${x} ${y - r - 6} L${x + r + 6} ${y} L${x} ${y + r + 6} L${x - r - 6} ${y} Z`
  if (m.shape === 'hex') {
    const pts = Array.from({ length: 6 }, (_, i) => { const a = (Math.PI / 3) * i - Math.PI / 6; return `${(x + r * Math.cos(a)).toFixed(1)} ${(y + r * Math.sin(a)).toFixed(1)}` })
    return `M${pts.join(' L')} Z`
  }
  return `M${x - r} ${y} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`
}

type Hover = { kind: 'merchant' | 'agent'; id: string } | null

export interface StageProps {
  variant: 'hero' | 'lab'
  events: LabEvent[]
  tick: number
  nonce: number
  injectionTick: number | null
  hasRun: boolean
  runId?: string | undefined
}

export function NetworkStage({ variant, events, tick, nonce, injectionTick, hasRun, runId }: StageProps) {
  const [hover, setHover] = useState<Hover>(null)
  const tally = useMemo(() => tallyUpTo(events, tick), [events, tick])
  const agentSt = useMemo(() => agentStateAt(events, tick), [events, tick])
  const active = useMemo(() => events.filter(e => e.tick === tick && e.agentId && e.merchantId && ['attempt', 'success', 'fail', 'switch'].includes(kindOf(e.type))), [events, tick])
  const injected = injectionTick !== null && tick >= injectionTick
  const maxFulfilled = Math.max(1, ...Object.values(tally).map(t => t.fulfilled))
  const mById = (id: string | null) => MERCHANTS.find(m => m.id === id)

  const hoveredMerchant = hover?.kind === 'merchant' ? MERCHANTS.find(m => m.id === hover.id) : undefined
  const hoveredAgent = hover?.kind === 'agent' ? AGENTS.find(a => a.id === hover.id) : undefined

  return (
    <div className={`stage stage-${variant}`}>
      <svg viewBox="0 0 1000 600" role="img" aria-label={hasRun ? `Commerce network at tick ${tick}: five buyer agents and three merchants` : 'Commerce network: five buyer agents and three merchants, waiting for a run'}>
        <defs>
          <radialGradient id="halo" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#FF6B35" stopOpacity=".22" /><stop offset="100%" stopColor="#FF6B35" stopOpacity="0" /></radialGradient>
          <filter id="soft"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <ellipse cx="500" cy="300" rx="480" ry="290" fill="url(#halo)" />

        {/* dim guide lines: every agent can reach every merchant */}
        {AGENTS.map(a => MERCHANTS.map(m => <line key={`g${a.id}${m.id}`} x1={a.x} y1={a.y} x2={m.x} y2={m.y} className="guide" />))}

        {/* current assignment per agent */}
        {AGENTS.map(a => { const m = mById(agentSt[a.id]!.merchantId); return m ? <line key={`c${a.id}`} x1={a.x} y1={a.y} x2={m.x} y2={m.y} stroke={a.color} className="assign" /> : null })}

        {/* pulses = real events at this tick */}
        {active.map(e => {
          const a = AGENTS.find(x => x.id === e.agentId); const m = mById(e.merchantId)
          if (!a || !m) return null
          const k = kindOf(e.type)
          return <line key={`${e.id}-${nonce}`} x1={a.x} y1={a.y} x2={m.x} y2={m.y} className={`pulse pulse-${k}`} stroke={KIND_COLOR[k]} />
        })}

        {/* merchants */}
        {MERCHANTS.map(m => {
          const t = tally[m.id]!
          const total = t.fulfilled + t.failed
          const failRatio = total ? t.failed / total : 0
          const fill = t.fulfilled / maxFulfilled
          return (
            <g key={m.id} tabIndex={0} className="node" role="group"
              aria-label={`${m.name}: ${t.attempts} attempts, ${t.fulfilled} fulfilled, ${t.failed} failed`}
              onMouseEnter={() => setHover({ kind: 'merchant', id: m.id })} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover({ kind: 'merchant', id: m.id })} onBlur={() => setHover(null)}>
              <path d={shapePath(m, 78)} fill={m.color} opacity={0.08 + fill * 0.14} filter="url(#soft)" />
              <path d={shapePath(m, 56)} fill="#141414" stroke={failRatio > 0 ? '#F87171' : m.color} strokeWidth={failRatio > 0 ? 2 + failRatio * 4 : 2} />
              <path d={shapePath(m, 56)} fill={m.color} opacity={0.12 + fill * 0.35} />
              <text x={m.x} y={m.y - 4} textAnchor="middle" className="n-name">{m.name}</text>
              <text x={m.x} y={m.y + 16} textAnchor="middle" className="n-sub">{hasRun ? `${t.fulfilled} ok · ${t.failed} failed` : 'merchant'}</text>
            </g>
          )
        })}

        {/* agents */}
        {AGENTS.map(a => {
          const s = agentSt[a.id]!
          return (
            <g key={a.id} tabIndex={0} className="node" role="group" aria-label={`${a.name}, ${a.phenotype}, ${s.status}`}
              onMouseEnter={() => setHover({ kind: 'agent', id: a.id })} onMouseLeave={() => setHover(null)}
              onFocus={() => setHover({ kind: 'agent', id: a.id })} onBlur={() => setHover(null)}>
              <circle cx={a.x} cy={a.y} r={30} fill="#141414" stroke={a.color} strokeWidth={s.status === 'abandoned' ? 1 : 3} strokeDasharray={s.status === 'abandoned' ? '4 4' : undefined} opacity={s.status === 'abandoned' ? 0.55 : 1} />
              <text x={a.x} y={a.y + 7} textAnchor="middle" className="glyph" fill={a.color}>{a.glyph}</text>
              <text x={a.x} y={a.y + 52} textAnchor="middle" className="n-sub">{a.name}</text>
            </g>
          )
        })}

        {/* intervention marker */}
        {injectionTick !== null && (
          <g transform="translate(500 34)">
            <rect x={-132} y={-18} width={264} height={32} rx={16} className={injected ? 'marker on' : 'marker'} />
            <text x={0} y={3} textAnchor="middle" className="marker-t">{injected ? `⚡ INJECTION ACTIVE · since t=${injectionTick}` : `⚡ injection scheduled · t=${injectionTick}`}</text>
          </g>
        )}
      </svg>

      <div className="tip" aria-live="polite">
        {hoveredMerchant && (() => { const t = tally[hoveredMerchant.id]!; return (
          <><b style={{ color: hoveredMerchant.color }}>{hoveredMerchant.name}</b><span>{hoveredMerchant.id}</span>
            <span>Attempts {t.attempts} · Fulfilled {t.fulfilled} · Failed {t.failed}</span><span className="dim">as of tick {tick}, from recorded events</span></>) })()}
        {hoveredAgent && (() => { const s = agentSt[hoveredAgent.id]!; return (
          <><b style={{ color: hoveredAgent.color }}>{hoveredAgent.name}</b><span>{hoveredAgent.phenotype}</span>
            <span>Status {s.status} · at {mById(s.merchantId)?.name ?? '—'}</span><span>Fulfilled {s.fulfilled} · Failures {s.failures} · Switches {s.switches}</span></>) })()}
        {!hover && <span className="dim">{hasRun ? `Hover or focus a node. ${runId ? `Run ${runId} · ` : ''}recorded playback` : 'Hover or focus a node for details'}</span>}
      </div>
    </div>
  )
}

export function PlaybackBar(props: {
  totalTicks: number; tick: number; playing: boolean; speed: number
  injectionTick: number | null; runId: string; eventCount: number
  onToggle: () => void; onSeek: (t: number) => void; onSpeed: (s: number) => void
}) {
  const { totalTicks, tick, playing, speed, injectionTick } = props
  const injPct = injectionTick !== null && totalTicks > 0 ? (injectionTick / totalTicks) * 100 : null
  return (
    <div className="playback">
      <button className="btn btn-icon" onClick={props.onToggle} aria-label={playing ? 'Pause playback' : 'Play recording'}>{playing ? '❚❚' : '▶'}</button>
      <div className="scrub">
        <input type="range" min={0} max={totalTicks} value={tick} onChange={e => props.onSeek(Number(e.target.value))} aria-label="Playback tick" />
        {injPct !== null && <span className="inj" style={{ left: `${injPct}%` }} aria-hidden="true" title={`Injection at tick ${injectionTick}`} />}
      </div>
      <span className="tick-readout" aria-live="off">t = {tick}/{totalTicks}</span>
      <label className="speed">Speed
        <select value={speed} onChange={e => props.onSpeed(Number(e.target.value))} aria-label="Playback speed">
          <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
        </select>
      </label>
      <span className="badge badge-rec" title="This replays events the simulation engine already recorded. It is not a live stream.">RECORDED PLAYBACK · run {props.runId} · {props.eventCount} events</span>
    </div>
  )
}

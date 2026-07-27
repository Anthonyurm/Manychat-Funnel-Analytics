import { useEffect, useState } from 'react'
import { getFunnels, computeOverview } from '../lib/db'
import { Spinner, pct, colorFor } from '../components/UI'

// FIX: minimum sample sizes. Every verdict below is gated so the app cannot
// confidently report a pattern off one or two matching messages.
const MIN_PATTERN_MATCHES = 3
const MIN_CORRELATION_N = 8
const MIN_BUCKET = 2

// FIX 7: match straight AND curly quotes. The old regex only had curly, so the
// song title pattern almost never fired.
const QUOTED = /["“”'].+["“”']/

// FIX 6: signed delta so an improvement never renders as a double negative
function ppLabel(v) {
  if (v == null || Number.isNaN(v)) return 'n/a'
  const r = Number(v).toFixed(1)
  return (Number(v) > 0 ? '+' : '') + r + 'pp'
}

function neutralCheck(withMessages, patterns) {
  const sorted = [...withMessages].sort((a, b) => (b.m1_ctr_pct || 0) - (a.m1_ctr_pct || 0))
  const top = sorted.slice(0, Math.ceil(sorted.length / 2))
  const bottom = sorted.slice(Math.ceil(sorted.length / 2))
  return patterns.map(p => {
    const topRate = top.length ? top.filter(f => f.m1_message && p.test(f.m1_message)).length / top.length : 0
    const bottomRate = bottom.length ? bottom.filter(f => f.m1_message && p.test(f.m1_message)).length / bottom.length : 0
    const isNeutral = topRate > 0.3 && bottomRate > 0.3 && Math.abs(topRate - bottomRate) < 0.25
    return { ...p, topRate, bottomRate, isNeutral }
  })
}

function patternStats(withMessages, patterns) {
  return neutralCheck(withMessages, patterns).map(p => {
    const matched = withMessages.filter(f => f.m1_message && p.test(f.m1_message))
    const notMatched = withMessages.filter(f => !f.m1_message || !p.test(f.m1_message))
    const mAvg = matched.length ? matched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / matched.length : null
    const nAvg = notMatched.length ? notMatched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / notMatched.length : null
    const delta = mAvg != null && nAvg != null ? +(mAvg - nAvg).toFixed(1) : null
    return {
      ...p,
      count: matched.length,
      compareCount: notMatched.length,
      matchedAvg: mAvg != null ? +mAvg.toFixed(1) : null,
      notMatchedAvg: nAvg != null ? +nAvg.toFixed(1) : null,
      delta,
    }
  })
  .filter(p => p.count >= MIN_PATTERN_MATCHES && p.compareCount >= MIN_PATTERN_MATCHES && p.delta != null)
  .sort((a, b) => (b.delta || 0) - (a.delta || 0))
}

function BarRow({ label, value, max = 80, sub, accentLow = 30, accentHigh = 60, trailing }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 13, color: 'var(--text)', minWidth: 190 }}>{label}</div>
      <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.min(100, (value || 0) / max * 100)}%`, background: colorFor(value, accentLow, accentHigh), borderRadius: 3 }} />
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: colorFor(value, accentLow, accentHigh), fontWeight: 700, minWidth: 52, textAlign: 'right' }}>{pct(value)}</div>
      {sub && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', minWidth: 70 }}>{sub}</div>}
      {trailing}
    </div>
  )
}

function NotEnoughData({ children }) {
  return (
    <div className="card">
      <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7 }}>{children}</div>
    </div>
  )
}

export default function MessageIntel() {
  const [data, setData] = useState(null)
  const [rawFunnels, setRawFunnels] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ranking')
  const [versionFilter, setVersionFilter] = useState('all')
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    getFunnels()
      .then(funnels => { setRawFunnels(funnels); setData(computeOverview(funnels)) })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function runAI(filteredFunnels, averages, filter) {
    setAiLoading(true)
    setAiText('')
    const funnelRows = filteredFunnels
      .filter(f => f.m1_message)
      .sort((a, b) => (b.m1_ctr_pct || 0) - (a.m1_ctr_pct || 0))
      .map(f => `- Message: "${f.m1_message}" | CTA: "${f.m1_cta || 'N/A'}" → M1 CTR ${f.m1_ctr_pct ?? 'N/A'}%, Open ${f.m1_open_rate_pct ?? 'N/A'}%, Funnel CR ${f.funnel_cr_pct ?? 'N/A'}%, Steps ${f.step_count}, Volume ${f.effective_sent ?? 'N/A'}`)
      .join('\n')

    const prompt = `You are a conversion copywriting expert analyzing ManyChat DM funnel performance for a music artist. ${filter !== 'all' ? `These are all "${filter}" funnels.` : 'These funnels span all types.'}

Message variations ranked by CTR with performance data:

${funnelRows}

Volume weighted averages: M1 CTR ${averages.m1_ctr_pct}%, Funnel CR ${averages.funnel_cr_pct}%

Weight your conclusions by the Volume figure. A funnel with 30 sends is not evidence on the level of one with 3000, and you should say so plainly rather than treating them equally.

First state any wording that appears in BOTH top and bottom converters as a neutral pattern that does not drive conversion.

Then analyze:
1. Message body patterns in the highest converters. Quote the copy and cite the CTR.
2. CTA button patterns that convert best and worst.
3. Body and CTA combinations that work well together.
4. The single most impactful change for the next funnel.
5. Two new M1 message and CTA combinations to A/B test, in the same casual voice.

Be specific. Quote actual copy. Reference actual numbers. No emojis. Max 400 words.`

    try {
      const resp = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })
      if (!resp.ok) throw new Error('Function error')
      setAiText(await resp.text())
    } catch {
      setAiText('AI analysis unavailable. Make sure ANTHROPIC_API_KEY is set in Netlify environment variables.')
    }
    setAiLoading(false)
  }

  if (loading) return <Spinner />
  if (!data || data.funnels.length === 0) return (
    <div className="empty-state"><h3>No funnels yet</h3><p>Add funnels to see message analysis.</p></div>
  )

  const { funnels, versions, buildAverages } = data
  const filtered = versionFilter === 'all' ? funnels : funnels.filter(f => f.version === versionFilter)
  const filteredAvgs = buildAverages(versionFilter === 'all' ? null : versionFilter)
  const withMsgs = filtered.filter(f => f.m1_message && f.m1_ctr_pct != null)
  const ranked = [...withMsgs].sort((a, b) => (b.m1_ctr_pct || 0) - (a.m1_ctr_pct || 0))
  const bottom = [...withMsgs].sort((a, b) => (a.m1_ctr_pct || 0) - (b.m1_ctr_pct || 0)).slice(0, 5)

  const PATTERNS = [
    { label: '"ayooo" opener', test: m => m.toLowerCase().startsWith('ayooo') },
    { label: '"ayoo" opener', test: m => m.toLowerCase().startsWith('ayoo') && !m.toLowerCase().startsWith('ayooo') },
    { label: '"thanks for liking"', test: m => m.toLowerCase().includes('thanks for liking') },
    { label: '"i\'ll send you"', test: m => m.toLowerCase().includes("i'll send you") },
    { label: '"click below"', test: m => m.toLowerCase().includes('click below') },
    { label: '"click here"', test: m => m.toLowerCase().includes('click here') },
    { label: 'Song title in quotes', test: m => QUOTED.test(m) },
    { label: 'Pre-save or exclusive framing', test: m => /before|public|early|exclusive|pre.?save/i.test(m) },
    { label: 'Short message under 70 characters', test: m => m.length < 70 },
    { label: 'Question opener', test: m => /^(have|did|do you|are you|where|what|who)\b/i.test(m.trim()) || /\?/.test(m.slice(0, 60)) },
    { label: 'Contains emoji in body', test: m => /[\u{1F300}-\u{1F9FF}]/u.test(m) },
    { label: 'Mission or manifesto framing', test: m => /mission|movement|we on a|i make music for|rebuild|culture/i.test(m) },
  ]

  const stats = patternStats(withMsgs, PATTERNS)
  const neutral = stats.filter(p => p.isNeutral)
  const positive = stats.filter(p => !p.isNeutral && (p.delta || 0) > 2)
  const negative = stats.filter(p => !p.isNeutral && (p.delta || 0) < -2)
  const rowStyle = { padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13, lineHeight: 1.7 }

  // ── STRUCTURE ─────────────────────────────────────────────────────────────
  const withCr = filtered.filter(f => f.funnel_cr_pct != null && f.step_count > 0)

  const groupAvg = (items, keyFn, valFn) => {
    const g = {}
    items.forEach(f => {
      const k = keyFn(f)
      if (k == null) return
      if (!g[k]) g[k] = []
      g[k].push(valFn(f))
    })
    return Object.entries(g)
      .map(([k, vals]) => ({ key: Number(k), avg: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1), count: vals.length }))
      .sort((a, b) => a.key - b.key)
  }

  const stepCrData = groupAvg(withCr, f => f.step_count, f => f.funnel_cr_pct)
  const branchCrData = groupAvg(withCr, f => f.branch_count, f => f.funnel_cr_pct)

  // FIX 5: per step CTR, not cumulative, so this measures message strength
  const stepPositionData = []
  for (let i = 1; i <= data.maxSteps; i++) {
    const vals = filtered.map(f => f[`m${i}_step_ctr_pct`]).filter(v => v != null)
    if (vals.length) {
      stepPositionData.push({
        position: i,
        avgCtr: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1),
        count: vals.length,
      })
    }
  }
  let steepestDrop = null
  for (let i = 1; i < stepPositionData.length; i++) {
    const drop = stepPositionData[i - 1].avgCtr - stepPositionData[i].avgCtr
    if (!steepestDrop || drop > steepestDrop.drop) {
      steepestDrop = { from: stepPositionData[i - 1].position, to: stepPositionData[i].position, drop: +drop.toFixed(1) }
    }
  }

  // FIX 4: correlate M1 CTR against downstream CR (no shared denominator),
  // and only once there are enough funnels for a coefficient to mean anything
  const withBoth = filtered.filter(f => f.m1_ctr_pct != null && f.downstream_cr_pct != null)
  let corr = null
  if (withBoth.length >= MIN_CORRELATION_N) {
    const n = withBoth.length
    const X = withBoth.map(f => f.m1_ctr_pct)
    const Y = withBoth.map(f => f.downstream_cr_pct)
    const sX = X.reduce((a, b) => a + b, 0), sY = Y.reduce((a, b) => a + b, 0)
    const sXY = X.reduce((a, x, i) => a + x * Y[i], 0)
    const sX2 = X.reduce((a, x) => a + x * x, 0), sY2 = Y.reduce((a, y) => a + y * y, 0)
    const den = Math.sqrt((n * sX2 - sX ** 2) * (n * sY2 - sY ** 2))
    corr = den > 0 ? +((n * sXY - sX * sY) / den).toFixed(2) : null
  }

  const sortedByCr = [...withCr].sort((a, b) => b.funnel_cr_pct - a.funnel_cr_pct)
  const canQuartile = sortedByCr.length >= 4
  const qSize = Math.max(1, Math.floor(sortedByCr.length / 4))
  const topQ = canQuartile ? sortedByCr.slice(0, qSize) : []
  const botQ = canQuartile ? sortedByCr.slice(-qSize) : []
  const topAvgSteps = topQ.length ? +(topQ.reduce((s, f) => s + f.step_count, 0) / topQ.length).toFixed(1) : null
  const botAvgSteps = botQ.length ? +(botQ.reduce((s, f) => s + f.step_count, 0) / botQ.length).toFixed(1) : null

  const unweightedCount = filtered.filter(f => f.funnel_cr_pct != null && !f.cr_is_weighted).length

  // ── AUDIENCE ──────────────────────────────────────────────────────────────
  const streamingTotals = {}
  let streamingGrandTotal = 0
  const communityJoinRates = []
  const heardMusicRatios = []

  rawFunnels.forEach(f => {
    if (!f.connections) return
    f.connections.forEach(conn => {
      if (!conn.branch_metadata) return
      try {
        const meta = typeof conn.branch_metadata === 'string' ? JSON.parse(conn.branch_metadata) : conn.branch_metadata
        if (!meta?.branches?.length) return
        const branches = meta.branches
        const totalSent = meta.total_sent_at_split || branches.reduce((s, b) => s + (b.sent || 0), 0)
        if (!totalSent) return

        const streamingLabels = ['spotify', 'apple', 'youtube', 'tidal', 'audiomack', 'amazon', 'soundcloud']
        const isStreaming = branches.some(b => streamingLabels.some(p => b.label?.toLowerCase().includes(p)))
        if (isStreaming) {
          // FIX: accumulate a single shared denominator so shares sum to 100
          branches.forEach(b => {
            if (!b.label || !b.sent) return
            const platform = streamingLabels.find(p => b.label.toLowerCase().includes(p))
            if (!platform) return
            streamingTotals[platform] = (streamingTotals[platform] || 0) + b.sent
            streamingGrandTotal += b.sent
          })
        }

        const heardLabels = ['yes', 'heard', 'have', 'listened']
        if (branches.some(b => heardLabels.some(l => b.label?.toLowerCase().includes(l)))) {
          const yes = branches.find(b => heardLabels.some(l => b.label?.toLowerCase().includes(l)))
          if (yes?.sent) heardMusicRatios.push(yes.sent / totalSent * 100)
        }

        const communityLabels = ['discord', 'community', 'joined', 'member', 'group', 'patreon', 'whatsapp']
        if (branches.some(b => communityLabels.some(l => b.label?.toLowerCase().includes(l)))) {
          const yes = branches.find(b => communityLabels.some(l => b.label?.toLowerCase().includes(l)))
          if (yes?.sent) communityJoinRates.push(yes.sent / totalSent * 100)
        }
      } catch {}
    })
  })

  const streamingEntries = Object.entries(streamingTotals)
    .map(([name, sent]) => ({ name, pct: streamingGrandTotal ? +(sent / streamingGrandTotal * 100).toFixed(1) : 0, sent }))
    .sort((a, b) => b.pct - a.pct)
  const avgHeardRatio = heardMusicRatios.length ? +(heardMusicRatios.reduce((a, b) => a + b, 0) / heardMusicRatios.length).toFixed(1) : null
  const avgCommunityRate = communityJoinRates.length ? +(communityJoinRates.reduce((a, b) => a + b, 0) / communityJoinRates.length).toFixed(1) : null

  // ── LENGTH ────────────────────────────────────────────────────────────────
  const lengthBuckets = [
    { label: 'Very short (under 60 chars)', test: m => m.length < 60 },
    { label: 'Short (60 to 100 chars)', test: m => m.length >= 60 && m.length < 100 },
    { label: 'Medium (100 to 160 chars)', test: m => m.length >= 100 && m.length < 160 },
    { label: 'Long (160+ chars)', test: m => m.length >= 160 },
  ]
  const lengthData = lengthBuckets.map(b => {
    const matched = withMsgs.filter(f => f.m1_message && b.test(f.m1_message))
    return {
      label: b.label,
      avgCtr: matched.length ? +(matched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / matched.length).toFixed(1) : null,
      count: matched.length,
    }
  }).filter(d => d.count >= MIN_BUCKET)

  const TABS = [['ranking', 'M1 Rankings'], ['patterns', 'Wording Patterns'], ['structure', 'Funnel Structure'], ['audience', 'Audience Signals']]

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Message Intelligence</div>
          <div className="page-subtitle">What wording and structure converts best across your funnels</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="version-filter">
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Filter:</span>
            <select value={versionFilter} onChange={e => setVersionFilter(e.target.value)}>
              <option value="all">All Types</option>
              {versions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => runAI(filtered, filteredAvgs, versionFilter)} disabled={aiLoading}>
            {aiLoading ? <><span className="spinner" /> Analyzing…</> : 'Analyze with AI'}
          </button>
        </div>
      </div>

      {withMsgs.length < 6 && (
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '12px 18px', marginBottom: 20, fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--gold)' }}>Small sample</strong>. {withMsgs.length} funnel{withMsgs.length === 1 ? '' : 's'} in this view. Patterns need at least {MIN_PATTERN_MATCHES} funnels on each side of a comparison before they are reported, so most sections stay quiet until you add more.
        </div>
      )}

      {neutral.length > 0 && (
        <div style={{ background: 'rgba(136,136,170,0.08)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontSize: 13, lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text)' }}>Neutral patterns detected</strong>. this wording appears at similar rates in top and bottom converters and does not measurably move conversion:{' '}
          {neutral.map((p, i) => <span key={i}><strong style={{ color: 'var(--text)' }}>{p.label}</strong>{i < neutral.length - 1 ? ', ' : ''}</span>)}. Do not rely on these as levers.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={'btn btn-sm ' + (tab === id ? 'btn-primary' : 'btn-ghost')} style={{ border: 'none' }}>{label}</button>
        ))}
      </div>

      {tab === 'ranking' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          {[['Top Converting M1 Messages', ranked.slice(0, 7), false], ['Lowest Converting M1 Messages', bottom, true]].map(([title, list, isBottom]) => (
            <div className="card" key={title}>
              <div className="card-title">{title}</div>
              {list.map((f, i) => (
                <div key={f.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ width: 24, height: 24, borderRadius: 6, background: !isBottom && i === 0 ? 'rgba(245,158,11,0.2)' : 'var(--surface2)', color: isBottom ? 'var(--accent2)' : (i === 0 ? 'var(--gold)' : 'var(--muted)'), display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>{i + 1}</div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 13, color: 'var(--text)' }}>{f.name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.5, margin: '4px 0', borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>"{f.m1_message}"</div>
                    {f.m1_cta && <div style={{ fontSize: 11, color: isBottom ? '#E5484D' : 'var(--accent3)', fontFamily: 'var(--mono)', marginBottom: 4 }}>CTA: "{f.m1_cta}"</div>}
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                      <span style={{ color: colorFor(f.m1_ctr_pct, 30, 60), fontWeight: 700 }}>{pct(f.m1_ctr_pct)} CTR</span>
                      <span style={{ color: 'var(--muted)', margin: '0 6px' }}>·</span>
                      <span style={{ color: 'var(--muted)' }}>{(f.effective_sent || 0).toLocaleString()} sent</span>
                      {(f.effective_sent || 0) < 100 && <span style={{ color: 'var(--gold)', marginLeft: 6 }}>low volume</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'patterns' && (
        <div>
          {lengthData.length > 0 ? (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Message Length vs M1 CTR</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                Buckets with fewer than {MIN_BUCKET} funnels are hidden
              </div>
              {lengthData.map((d, i) => <BarRow key={i} label={d.label} value={d.avgCtr} sub={`${d.count} funnel${d.count !== 1 ? 's' : ''}`} />)}
            </div>
          ) : null}

          {positive.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Patterns That Help Conversion</div>
              {positive.map((p, i) => (
                <div key={i} style={rowStyle}>
                  <strong style={{ color: 'var(--accent3)' }}>{p.label}</strong>
                  {'. '}{p.count} funnels use this at <strong style={{ color: 'var(--accent3)' }}>{pct(p.matchedAvg)}</strong> average CTR vs {pct(p.notMatchedAvg)} across the {p.compareCount} without it ({ppLabel(p.delta)})
                </div>
              ))}
            </div>
          )}

          {neutral.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Neutral Patterns. No Measurable Impact</div>
              {neutral.map((p, i) => (
                <div key={i} style={rowStyle}>
                  <strong style={{ color: 'var(--text)' }}>{p.label}</strong>
                  {'. '}in {Math.round(p.topRate * 100)}% of top converters and {Math.round(p.bottomRate * 100)}% of bottom converters. Delta {ppLabel(p.delta)}
                </div>
              ))}
            </div>
          )}

          {negative.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Patterns That Hurt Conversion</div>
              {negative.map((p, i) => (
                <div key={i} style={rowStyle}>
                  <strong style={{ color: 'var(--accent2)' }}>{p.label}</strong>
                  {'. '}{p.count} funnels average <strong style={{ color: 'var(--accent2)' }}>{pct(p.matchedAvg)}</strong> CTR vs {pct(p.notMatchedAvg)} across the {p.compareCount} without it ({ppLabel(p.delta)})
                </div>
              ))}
            </div>
          )}

          {positive.length === 0 && neutral.length === 0 && negative.length === 0 && lengthData.length === 0 && (
            <NotEnoughData>
              No pattern meets the reporting threshold yet. A pattern needs at least {MIN_PATTERN_MATCHES} funnels containing it and {MIN_PATTERN_MATCHES} without it before a verdict is shown.
            </NotEnoughData>
          )}
        </div>
      )}

      {tab === 'structure' && (
        <div>
          {unweightedCount > 0 && (
            <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '12px 18px', marginBottom: 16, fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--gold)' }}>{unweightedCount} funnel{unweightedCount === 1 ? '' : 's'} using majority path CR</strong>. these were uploaded before branch capture, so their end to end CR counts only the largest branch and understates the true result. Re upload their screenshots to get the weighted figure.
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">M1 CTR as a Predictor of Downstream CR</div>
            {corr != null ? (
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8 }}>
                Correlation across {withBoth.length} funnels: <strong style={{ color: colorFor(Math.abs(corr) * 100, 40, 70) }}>{corr}</strong>
                {'. '}{Math.abs(corr) >= 0.7
                  ? 'Strong. Funnels that win at M1 keep winning downstream, so first message copy is your highest leverage move.'
                  : Math.abs(corr) >= 0.4
                  ? 'Moderate. M1 matters but downstream steps carry real independent weight.'
                  : 'Weak. A strong first message does not predict what happens after it. Optimise the middle of the funnel.'}
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
                  Measured against downstream CR (terminal clicks divided by M1 clicks) rather than funnel CR, which shares a denominator with M1 CTR and would correlate on arithmetic alone.
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.7 }}>
                Needs {MIN_CORRELATION_N} funnels before a coefficient is meaningful. Currently {withBoth.length}.
              </div>
            )}

            {topAvgSteps != null && botAvgSteps != null && (
              <div style={{ marginTop: 14, padding: '12px 0', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Top quartile converters</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent3)' }}>{topAvgSteps} <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>avg steps</span></div>
                </div>
                <div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Bottom quartile converters</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent2)' }}>{botAvgSteps} <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>avg steps</span></div>
                </div>
              </div>
            )}
          </div>

          {stepCrData.length > 1 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Number of Steps vs End to End CR</div>
              {stepCrData.map((d, i) => <BarRow key={i} label={`${d.key} step${d.key !== 1 ? 's' : ''}`} value={d.avg} accentLow={15} accentHigh={40} sub={`${d.count} funnel${d.count !== 1 ? 's' : ''}`} />)}
            </div>
          )}

          {branchCrData.length > 1 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Number of Branches vs End to End CR</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                Does splitting the audience into personalised paths actually pay off
              </div>
              {branchCrData.map((d, i) => <BarRow key={i} label={d.key === 0 ? 'Linear (no branches)' : `${d.key} branch point${d.key !== 1 ? 's' : ''}`} value={d.avg} accentLow={15} accentHigh={40} sub={`${d.count} funnel${d.count !== 1 ? 's' : ''}`} />)}
            </div>
          )}

          {stepPositionData.length > 1 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Average Per Step CTR by Position</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                Each step measured against its own sent count, so this reflects message strength rather than the automatic decline of a cumulative figure
                {steepestDrop && steepestDrop.drop > 0 && <span>. steepest fall is M{steepestDrop.from} to M{steepestDrop.to} at {steepestDrop.drop}pp</span>}
              </div>
              {stepPositionData.map((d, i) => (
                <BarRow
                  key={i}
                  label={`M${d.position}`}
                  value={d.avgCtr}
                  sub={`${d.count} funnel${d.count !== 1 ? 's' : ''}`}
                  trailing={i > 0 ? (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: stepPositionData[i - 1].avgCtr >= d.avgCtr ? 'var(--accent2)' : 'var(--accent3)', minWidth: 56, textAlign: 'right' }}>
                      {ppLabel(d.avgCtr - stepPositionData[i - 1].avgCtr)}
                    </div>
                  ) : <div style={{ minWidth: 56 }} />}
                />
              ))}
            </div>
          )}

          {stepCrData.length <= 1 && branchCrData.length <= 1 && stepPositionData.length <= 1 && (
            <NotEnoughData>Add more funnels to compare structure against conversion.</NotEnoughData>
          )}
        </div>
      )}

      {tab === 'audience' && (
        <div>
          {streamingEntries.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Streaming Platform Distribution</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                Share of {streamingGrandTotal.toLocaleString()} platform selections across every funnel that asks
              </div>
              {streamingEntries.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', minWidth: 120, textTransform: 'capitalize', fontWeight: i === 0 ? 700 : 400 }}>{d.name}</div>
                  <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${d.pct}%`, background: 'var(--accent)', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', fontWeight: 700, minWidth: 52, textAlign: 'right' }}>{d.pct}%</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', minWidth: 60 }}>{d.sent.toLocaleString()}</div>
                </div>
              ))}
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                Use this to decide where distribution and promotion spend actually lands.
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {avgHeardRatio != null && (
              <div className="card" style={{ marginBottom: 0 }}>
                <div className="card-title">Heard Your Music Before</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: colorFor(avgHeardRatio, 30, 60), letterSpacing: -1, marginBottom: 8 }}>{avgHeardRatio}%</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                  across {heardMusicRatios.length} split{heardMusicRatios.length === 1 ? '' : 's'}. {avgHeardRatio >= 50
                    ? 'More than half already know your catalogue.'
                    : 'Most are discovering you here, so first impressions carry the funnel.'}
                </div>
              </div>
            )}
            {avgCommunityRate != null && (
              <div className="card" style={{ marginBottom: 0 }}>
                <div className="card-title">Community Engagement Rate</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: colorFor(avgCommunityRate, 15, 35), letterSpacing: -1, marginBottom: 8 }}>{avgCommunityRate}%</div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                  across {communityJoinRates.length} split{communityJoinRates.length === 1 ? '' : 's'}. {avgCommunityRate >= 30
                    ? 'Strong penetration among your active audience.'
                    : 'Most of this audience is not in your community yet.'}
                </div>
              </div>
            )}
          </div>

          {streamingEntries.length === 0 && avgHeardRatio == null && avgCommunityRate == null && (
            <NotEnoughData>
              Audience signals come from multi button splits such as streaming platform choice or a heard my music question. Upload funnels containing those steps to populate this tab.
            </NotEnoughData>
          )}
        </div>
      )}

      {(aiText || aiLoading) && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-title">
            AI Analysis
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>powered by Claude</span>
            {versionFilter !== 'all' && <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', marginLeft: 8 }}>{versionFilter} only</span>}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
            {aiText.split('\n').map((line, i) => <div key={i}>{line || <br />}</div>)}
            {aiLoading && <span className="typing-cursor" />}
          </div>
        </div>
      )}
    </div>
  )
}

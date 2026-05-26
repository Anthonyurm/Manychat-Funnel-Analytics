import { useEffect, useState } from 'react'
import { getFunnels, computeOverview, normaliseSteps } from '../lib/db'
import { Spinner, pct, colorFor } from '../components/UI'

// ── PATTERN HELPERS ───────────────────────────────────────────────────────────
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
  const patternsWithNeutral = neutralCheck(withMessages, patterns)
  return patternsWithNeutral.map(p => {
    const matched = withMessages.filter(f => f.m1_message && p.test(f.m1_message))
    const notMatched = withMessages.filter(f => !f.m1_message || !p.test(f.m1_message))
    const mAvg = matched.length ? matched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / matched.length : null
    const nAvg = notMatched.length ? notMatched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / notMatched.length : null
    const delta = mAvg != null && nAvg != null ? +(mAvg - nAvg).toFixed(1) : null
    return { ...p, count: matched.length, matchedAvg: mAvg ? +mAvg.toFixed(1) : null, notMatchedAvg: nAvg ? +nAvg.toFixed(1) : null, delta }
  }).filter(p => p.count > 0).sort((a, b) => (b.delta || 0) - (a.delta || 0))
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
      .then(funnels => {
        setRawFunnels(funnels)
        setData(computeOverview(funnels))
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function runAI(filteredFunnels, averages, filter) {
    setAiLoading(true)
    setAiText('')
    const funnelRows = filteredFunnels
      .filter(f => f.m1_message)
      .sort((a, b) => (b.m1_ctr_pct || 0) - (a.m1_ctr_pct || 0))
      .map(f => `- Message: "${f.m1_message}" | CTA: "${f.m1_cta || 'N/A'}" -> CTR: ${f.m1_ctr_pct ?? 'N/A'}%, Open: ${f.m1_open_rate_pct ?? 'N/A'}%, Funnel CR: ${f.funnel_cr_pct ?? 'N/A'}%, Steps: ${f.step_count}`)
      .join('\n')

    const prompt = `You are a conversion copywriting expert analyzing ManyChat DM funnel performance for a music artist. ${filter !== 'all' ? `These are all "${filter}" funnels.` : 'These funnels span all types.'}

Here are all message variations ranked by CTR with actual performance data:

${funnelRows}

Overall averages: M1 CTR ${averages.m1_ctr_pct}%, Funnel CR ${averages.funnel_cr_pct}%

First, check whether any wording or phrases appear in BOTH the top and bottom converters. If so, state this at the top as a neutral pattern.

Then analyze:
1. Message body patterns: Which specific words or phrases in the highest-converting messages drive clicks? Quote them with their CTR.
2. CTA button patterns: Which CTA text converts best and which should be avoided?
3. Combined patterns: Message body and CTA combinations that work especially well together.
4. The single most impactful change to make on the next funnel.
5. Two new M1 message and CTA combinations to A/B test, written in the same casual voice as the existing messages.

Be specific. Quote actual copy. Reference actual CTR numbers. No emojis. Max 400 words.`

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
    { label: 'Song title in quotes', test: m => /[""].+[""]/.test(m) },
    { label: 'Pre-save or exclusive framing', test: m => /before|public|early|exclusive|pre.?save/i.test(m) },
    { label: 'Short message under 70 characters', test: m => m.length < 70 },
    { label: 'Ends with punctuation or emoji', test: m => /[\!\)\:🖤🧡]+\s*$/.test(m.trim()) },
    { label: 'First person voice', test: m => /\bi\b|\bi'll\b|\bi'm\b/i.test(m) },
    { label: 'Question opener', test: m => m.trim().startsWith('have') || m.trim().startsWith('did') || m.trim().startsWith('do you') || m.trim().startsWith('are you') || /\?/.test(m.slice(0, 40)) },
    { label: 'Contains emoji in body', test: m => /[\u{1F300}-\u{1F9FF}]/u.test(m) },
  ]

  const stats = patternStats(withMsgs, PATTERNS)
  const neutral = stats.filter(p => p.isNeutral)
  const positive = stats.filter(p => !p.isNeutral && (p.delta || 0) > 2)
  const negative = stats.filter(p => !p.isNeutral && (p.delta || 0) < -2)
  const rowStyle = { padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13, lineHeight: 1.7 }

  // ── FUNNEL STRUCTURE ANALYSIS ─────────────────────────────────────────────
  const withCr = filtered.filter(f => f.funnel_cr_pct != null && f.step_count > 0)

  // Step count vs CR
  const stepGroups = {}
  withCr.forEach(f => {
    const k = f.step_count
    if (!stepGroups[k]) stepGroups[k] = []
    stepGroups[k].push(f.funnel_cr_pct)
  })
  const stepCrData = Object.entries(stepGroups)
    .map(([steps, crs]) => ({
      steps: parseInt(steps),
      avgCr: +(crs.reduce((a, b) => a + b, 0) / crs.length).toFixed(1),
      count: crs.length
    }))
    .sort((a, b) => a.steps - b.steps)

  // Average CTR by step position across all funnels
  const stepPositionData = []
  for (let i = 1; i <= data.maxSteps; i++) {
    const vals = filtered.map(f => f[`m${i}_ctr_pct`]).filter(v => v != null)
    if (vals.length) {
      stepPositionData.push({
        position: i,
        avgCtr: +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1),
        count: vals.length
      })
    }
  }

  // Drop-off between consecutive steps
  const dropOffData = []
  for (let i = 1; i < data.maxSteps; i++) {
    const pairs = filtered.filter(f => f[`m${i}_ctr_pct`] != null && f[`m${i + 1}_ctr_pct`] != null)
    if (pairs.length) {
      const avgDrop = pairs.reduce((s, f) => s + (f[`m${i}_ctr_pct`] - f[`m${i + 1}_ctr_pct`]), 0) / pairs.length
      dropOffData.push({ from: i, to: i + 1, avgDrop: +avgDrop.toFixed(1), count: pairs.length })
    }
  }
  const steepestDrop = dropOffData.sort((a, b) => b.avgDrop - a.avgDrop)[0]

  // M1 CTR as predictor of funnel CR
  const withBoth = filtered.filter(f => f.m1_ctr_pct != null && f.funnel_cr_pct != null)
  let m1CrCorrelation = null
  if (withBoth.length >= 3) {
    const n = withBoth.length
    const sumX = withBoth.reduce((s, f) => s + f.m1_ctr_pct, 0)
    const sumY = withBoth.reduce((s, f) => s + f.funnel_cr_pct, 0)
    const sumXY = withBoth.reduce((s, f) => s + f.m1_ctr_pct * f.funnel_cr_pct, 0)
    const sumX2 = withBoth.reduce((s, f) => s + f.m1_ctr_pct ** 2, 0)
    const sumY2 = withBoth.reduce((s, f) => s + f.funnel_cr_pct ** 2, 0)
    const num = n * sumXY - sumX * sumY
    const den = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2))
    m1CrCorrelation = den > 0 ? +(num / den).toFixed(2) : null
  }

  // Top/bottom quartile step count comparison
  const sortedByCr = [...withCr].sort((a, b) => b.funnel_cr_pct - a.funnel_cr_pct)
  const topQ = sortedByCr.slice(0, Math.ceil(sortedByCr.length / 4))
  const botQ = sortedByCr.slice(-Math.ceil(sortedByCr.length / 4))
  const topAvgSteps = topQ.length ? +(topQ.reduce((s, f) => s + f.step_count, 0) / topQ.length).toFixed(1) : null
  const botAvgSteps = botQ.length ? +(botQ.reduce((s, f) => s + f.step_count, 0) / botQ.length).toFixed(1) : null

  // ── AUDIENCE SEGMENTATION ─────────────────────────────────────────────────
  // Streaming platform distribution from branch metadata in raw funnels
  const streamingPlatforms = {}
  const communityJoinRates = []
  const heardMusicRatios = []

  rawFunnels.forEach(f => {
    if (!f.connections) return
    f.connections.forEach(conn => {
      if (!conn.branch_metadata) return
      try {
        const meta = typeof conn.branch_metadata === 'string'
          ? JSON.parse(conn.branch_metadata)
          : conn.branch_metadata
        if (!meta.branches) return

        const branches = meta.branches
        const totalSent = meta.total_sent_at_split || branches.reduce((s, b) => s + (b.sent || 0), 0)

        // Detect streaming platform splits
        const streamingLabels = ['spotify', 'apple', 'youtube', 'tidal', 'audiomack', 'amazon', 'soundcloud']
        const isStreamingSplit = branches.some(b => streamingLabels.some(p => b.label?.toLowerCase().includes(p)))
        if (isStreamingSplit && totalSent > 0) {
          branches.forEach(b => {
            if (!b.label || !b.sent) return
            const platform = streamingLabels.find(p => b.label.toLowerCase().includes(p)) || 'other'
            if (!streamingPlatforms[platform]) streamingPlatforms[platform] = { sent: 0, total: 0 }
            streamingPlatforms[platform].sent += b.sent
            streamingPlatforms[platform].total += totalSent
          })
        }

        // Detect heard music before splits
        const heardLabels = ['yes', 'heard', 'have', 'listened']
        const isHeardSplit = branches.some(b => heardLabels.some(l => b.label?.toLowerCase().includes(l)))
        if (isHeardSplit && totalSent > 0) {
          const yesBranch = branches.find(b => heardLabels.some(l => b.label?.toLowerCase().includes(l)))
          if (yesBranch?.sent) heardMusicRatios.push(yesBranch.sent / totalSent * 100)
        }

        // Detect community/engagement splits
        const communityLabels = ['discord', 'community', 'joined', 'member', 'group', 'patreon', 'whatsapp']
        const isCommunity = branches.some(b => communityLabels.some(l => b.label?.toLowerCase().includes(l)))
        if (isCommunity && totalSent > 0) {
          const yesBranch = branches.find(b => communityLabels.some(l => b.label?.toLowerCase().includes(l)))
          if (yesBranch?.sent) communityJoinRates.push(yesBranch.sent / totalSent * 100)
        }
      } catch {}
    })
  })

  const streamingEntries = Object.entries(streamingPlatforms)
    .map(([name, d]) => ({ name, pct: d.total > 0 ? +(d.sent / d.total * 100).toFixed(1) : 0 }))
    .sort((a, b) => b.pct - a.pct)
  const avgHeardRatio = heardMusicRatios.length
    ? +(heardMusicRatios.reduce((a, b) => a + b, 0) / heardMusicRatios.length).toFixed(1) : null
  const avgCommunityRate = communityJoinRates.length
    ? +(communityJoinRates.reduce((a, b) => a + b, 0) / communityJoinRates.length).toFixed(1) : null

  // ── MESSAGE LENGTH ANALYSIS ───────────────────────────────────────────────
  const lengthBuckets = [
    { label: 'Very short (< 60 chars)', test: m => m.length < 60 },
    { label: 'Short (60–100 chars)', test: m => m.length >= 60 && m.length < 100 },
    { label: 'Medium (100–160 chars)', test: m => m.length >= 100 && m.length < 160 },
    { label: 'Long (160+ chars)', test: m => m.length >= 160 },
  ]
  const lengthData = lengthBuckets.map(b => {
    const matched = withMsgs.filter(f => f.m1_message && b.test(f.m1_message))
    const avgCtr = matched.length ? +(matched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / matched.length).toFixed(1) : null
    return { label: b.label, avgCtr, count: matched.length }
  }).filter(d => d.count > 0)

  const TABS = [
    ['ranking', 'M1 Rankings'],
    ['patterns', 'Wording Patterns'],
    ['structure', 'Funnel Structure'],
    ['audience', 'Audience Signals'],
  ]

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

      {neutral.length > 0 && (
        <div style={{ background: 'rgba(136,136,170,0.08)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontSize: 13, lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text)' }}>Neutral patterns detected</strong> — the following wording appears equally in top and bottom converters and does not measurably influence conversion:{' '}
          {neutral.map((p, i) => (
            <span key={i}><strong style={{ color: 'var(--text)' }}>{p.label}</strong>{i < neutral.length - 1 ? ', ' : ''}</span>
          ))}. Do not rely on these as conversion levers.
        </div>
      )}

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={'btn btn-sm ' + (tab === id ? 'btn-primary' : 'btn-ghost')}
            style={{ border: 'none' }}>{label}</button>
        ))}
      </div>

      {/* ── M1 RANKINGS TAB ── */}
      {tab === 'ranking' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="card">
            <div className="card-title">Top Converting M1 Messages</div>
            {ranked.slice(0, 7).map((f, i) => (
              <div key={f.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: i === 0 ? 'rgba(255,209,102,0.2)' : 'var(--surface2)', color: i === 0 ? 'var(--gold)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13, color: 'var(--text)' }}>{f.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.5, margin: '4px 0', borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>"{f.m1_message}"</div>
                  {f.m1_cta && <div style={{ fontSize: 11, color: 'var(--accent3)', fontFamily: 'var(--mono)', marginBottom: 4 }}>CTA: "{f.m1_cta}"</div>}
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    <span style={{ color: colorFor(f.m1_ctr_pct, 30, 60), fontWeight: 700 }}>{pct(f.m1_ctr_pct)} CTR</span>
                    <span style={{ color: 'var(--muted)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--muted)' }}>{pct(f.m1_open_rate_pct)} open</span>
                    <span style={{ color: 'var(--muted)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--muted)' }}>{(f.effective_sent || f.total_sent || 0).toLocaleString()} sent</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="card-title">Lowest Converting M1 Messages</div>
            {bottom.map((f, i) => (
              <div key={f.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface2)', color: 'var(--accent2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13, color: 'var(--text)' }}>{f.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.5, margin: '4px 0', borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>"{f.m1_message}"</div>
                  {f.m1_cta && <div style={{ fontSize: 11, color: '#ff8099', fontFamily: 'var(--mono)', marginBottom: 4 }}>CTA: "{f.m1_cta}"</div>}
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    <span style={{ color: colorFor(f.m1_ctr_pct, 30, 60), fontWeight: 700 }}>{pct(f.m1_ctr_pct)} CTR</span>
                    <span style={{ color: 'var(--muted)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--muted)' }}>{(f.effective_sent || f.total_sent || 0).toLocaleString()} sent</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── WORDING PATTERNS TAB ── */}
      {tab === 'patterns' && (
        <div>
          {/* Message length */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-title">Message Length vs M1 CTR</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
              Average M1 CTR by message character count bucket
            </div>
            {lengthData.map((d, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontSize: 13, color: 'var(--text)', minWidth: 200 }}>{d.label}</div>
                <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, (d.avgCtr || 0) / 80 * 100)}%`, background: colorFor(d.avgCtr, 30, 60), borderRadius: 3 }} />
                </div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: colorFor(d.avgCtr, 30, 60), fontWeight: 700, minWidth: 50, textAlign: 'right' }}>{pct(d.avgCtr)}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', minWidth: 60 }}>{d.count} funnel{d.count !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>

          {positive.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Patterns That Help Conversion</div>
              {positive.map((p, i) => (
                <div key={i} style={rowStyle}>
                  <strong style={{ color: 'var(--accent3)' }}>{p.label}</strong>
                  {' '}— {p.count} funnels use this, averaging <strong style={{ color: 'var(--accent3)' }}>{pct(p.matchedAvg)} CTR</strong> vs {pct(p.notMatchedAvg)} without it (<strong>+{p.delta}pp</strong>)
                </div>
              ))}
            </div>
          )}

          {neutral.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Neutral Patterns — No Measurable Impact</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>These appear in both top and bottom converters. The data shows no meaningful CTR impact either way.</div>
              {neutral.map((p, i) => (
                <div key={i} style={rowStyle}>
                  <strong style={{ color: 'var(--text)' }}>{p.label}</strong>
                  {' '}— appears in {Math.round(p.topRate * 100)}% of top converters and {Math.round(p.bottomRate * 100)}% of bottom converters. Delta: <strong>{p.delta != null ? (p.delta > 0 ? '+' : '') + p.delta + 'pp' : 'approx 0pp'}</strong>
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
                  {' '}— averages <strong style={{ color: 'var(--accent2)' }}>{pct(p.matchedAvg)} CTR</strong> vs {pct(p.notMatchedAvg)} without it (<strong>{p.delta}pp</strong>)
                </div>
              ))}
            </div>
          )}

          {positive.length === 0 && neutral.length === 0 && negative.length === 0 && (
            <div className="card"><div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>Not enough data yet. Add more funnels for pattern detection.</div></div>
          )}
        </div>
      )}

      {/* ── FUNNEL STRUCTURE TAB ── */}
      {tab === 'structure' && (
        <div>
          {/* M1 CTR as CR predictor */}
          {m1CrCorrelation != null && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">M1 CTR as a Predictor of Funnel CR</div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.8 }}>
                Correlation coefficient: <strong style={{ color: colorFor(Math.abs(m1CrCorrelation) * 100, 40, 70) }}>{m1CrCorrelation}</strong>
                {' '}— {Math.abs(m1CrCorrelation) >= 0.7
                  ? 'Strong correlation. M1 CTR is a reliable predictor of end-to-end conversion. Optimizing your first message is your highest-leverage move.'
                  : Math.abs(m1CrCorrelation) >= 0.4
                  ? 'Moderate correlation. M1 CTR matters but downstream steps also have significant influence on end-to-end conversion.'
                  : 'Weak correlation. End-to-end conversion is driven more by downstream steps than the first message for your funnels.'}
              </div>
              {topAvgSteps != null && botAvgSteps != null && (
                <div style={{ marginTop: 14, padding: '12px 0', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Top 25% converters</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent3)' }}>{topAvgSteps} <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>avg steps</span></div>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Bottom 25% converters</div>
                    <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent2)' }}>{botAvgSteps} <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>avg steps</span></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step count vs CR */}
          {stepCrData.length > 1 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Number of Steps vs End-to-End CR</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>Average funnel CR by total message step count</div>
              {stepCrData.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', minWidth: 100 }}>{d.steps} step{d.steps !== 1 ? 's' : ''}</div>
                  <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (d.avgCr || 0) / 80 * 100)}%`, background: colorFor(d.avgCr, 15, 40), borderRadius: 3 }} />
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: colorFor(d.avgCr, 15, 40), fontWeight: 700, minWidth: 50, textAlign: 'right' }}>{pct(d.avgCr)}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', minWidth: 60 }}>{d.count} funnel{d.count !== 1 ? 's' : ''}</div>
                </div>
              ))}
            </div>
          )}

          {/* Average CTR by step position */}
          {stepPositionData.length > 1 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Average CTR by Step Position</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                Where engagement drops across all your funnels
                {steepestDrop && <span> — steepest drop-off is between <strong style={{ color: 'var(--text)' }}>M{steepestDrop.from} and M{steepestDrop.to}</strong> (avg -{steepestDrop.avgDrop}pp)</span>}
              </div>
              {stepPositionData.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', minWidth: 60, fontWeight: 700 }}>M{d.position}</div>
                  <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.min(100, (d.avgCtr || 0) / 80 * 100)}%`, background: colorFor(d.avgCtr, 30, 60), borderRadius: 3 }} />
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: colorFor(d.avgCtr, 30, 60), fontWeight: 700, minWidth: 50, textAlign: 'right' }}>{pct(d.avgCtr)}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', minWidth: 70 }}>{d.count} funnel{d.count !== 1 ? 's' : ''}</div>
                  {i > 0 && stepPositionData[i - 1] && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent2)', minWidth: 50 }}>
                      -{(stepPositionData[i - 1].avgCtr - d.avgCtr).toFixed(1)}pp
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {stepCrData.length <= 1 && stepPositionData.length <= 1 && (
            <div className="card"><div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>Add more funnels to see structure pattern analysis.</div></div>
          )}
        </div>
      )}

      {/* ── AUDIENCE SIGNALS TAB ── */}
      {tab === 'audience' && (
        <div>
          {streamingEntries.length > 0 && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="card-title">Streaming Platform Distribution</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
                Where your audience listens to music — across all funnels that ask the question
              </div>
              {streamingEntries.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 13, color: 'var(--text)', minWidth: 120, textTransform: 'capitalize', fontWeight: i === 0 ? 700 : 400 }}>{d.name}</div>
                  <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${d.pct}%`, background: 'var(--accent)', borderRadius: 3 }} />
                  </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', fontWeight: 700, minWidth: 50, textAlign: 'right' }}>{d.pct}%</div>
                </div>
              ))}
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                This tells you where to prioritize music distribution and promotion spend.
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            {avgHeardRatio != null && (
              <div className="card" style={{ marginBottom: 0 }}>
                <div className="card-title">Heard Your Music Before</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: colorFor(avgHeardRatio, 30, 60), letterSpacing: -1, marginBottom: 8 }}>
                  {avgHeardRatio}%
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                  of people entering your funnels have already heard your music. {avgHeardRatio >= 50
                    ? 'Your audience quality is strong — more than half are already fans.'
                    : 'Most entering your funnels are discovering you for the first time. Focus on strong first impressions.'}
                </div>
              </div>
            )}

            {avgCommunityRate != null && (
              <div className="card" style={{ marginBottom: 0 }}>
                <div className="card-title">Community Engagement Rate</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: colorFor(avgCommunityRate, 15, 35), letterSpacing: -1, marginBottom: 8 }}>
                  {avgCommunityRate}%
                </div>
                <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
                  of people asked about your community say they are already members. {avgCommunityRate >= 30
                    ? 'Strong community penetration among your active audience.'
                    : 'Most of your funnel audience are not yet community members — a significant growth opportunity.'}
                </div>
              </div>
            )}
          </div>

          {streamingEntries.length === 0 && avgHeardRatio == null && avgCommunityRate == null && (
            <div className="card">
              <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
                Audience signal data comes from funnels with multi-button splits (streaming platform selection, heard music before questions, etc.). Upload funnels with these question steps to see this analysis.
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Analysis */}
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

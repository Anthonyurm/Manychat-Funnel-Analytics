import { useEffect, useState } from 'react'
import { getFunnels, computeOverview } from '../lib/db'
import { Spinner, pct, colorFor } from '../components/UI'

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

export default function MessageIntel() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ranking')
  const [versionFilter, setVersionFilter] = useState('all')
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    getFunnels()
      .then(funnels => setData(computeOverview(funnels)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function runAI(filteredFunnels, averages, filter) {
    setAiLoading(true)
    setAiText('')
    const funnelRows = filteredFunnels
      .filter(f => f.m1_message)
      .sort((a, b) => (b.m1_ctr_pct || 0) - (a.m1_ctr_pct || 0))
      .map(f => `- Message: "${f.m1_message}" | CTA: "${f.m1_cta || 'N/A'}" -> CTR: ${f.m1_ctr_pct ?? 'N/A'}%, Open: ${f.m1_open_rate_pct ?? 'N/A'}%, Funnel CR: ${f.funnel_cr_pct ?? 'N/A'}%`)
      .join('\n')

    const prompt = `You are a conversion copywriting expert analyzing ManyChat DM funnel performance for a music artist. ${filter !== 'all' ? `These are all "${filter}" funnels.` : 'These funnels span all types.'}

Here are all message variations ranked by CTR with actual performance data:

${funnelRows}

Overall averages: M1 CTR ${averages.m1_ctr_pct}%, Funnel CR ${averages.funnel_cr_pct}%

First, check whether any wording or phrases appear in BOTH the top and bottom converters. If so, state this at the top as a neutral pattern — this wording does not drive conversion in either direction.

Then analyze:
1. Message body patterns: Which specific words or phrases in the highest-converting messages drive clicks? Quote them directly with their CTR.
2. CTA button patterns: Which CTA text converts best and which should be avoided? Be specific.
3. Combined patterns: Are there message body and CTA combinations that work especially well together?
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
  ]

  const patternsWithNeutral = neutralCheck(withMsgs, PATTERNS)
  const patternStats = patternsWithNeutral.map(p => {
    const matched = withMsgs.filter(f => f.m1_message && p.test(f.m1_message))
    const notMatched = withMsgs.filter(f => !f.m1_message || !p.test(f.m1_message))
    const mAvg = matched.length ? matched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / matched.length : null
    const nAvg = notMatched.length ? notMatched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / notMatched.length : null
    const delta = mAvg != null && nAvg != null ? +(mAvg - nAvg).toFixed(1) : null
    return { ...p, count: matched.length, matchedAvg: mAvg ? +mAvg.toFixed(1) : null, notMatchedAvg: nAvg ? +nAvg.toFixed(1) : null, delta }
  }).filter(p => p.count > 0).sort((a, b) => (b.delta || 0) - (a.delta || 0))

  const neutral = patternStats.filter(p => p.isNeutral)
  const positive = patternStats.filter(p => !p.isNeutral && (p.delta || 0) > 2)
  const negative = patternStats.filter(p => !p.isNeutral && (p.delta || 0) < -2)
  const rowStyle = { padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13, lineHeight: 1.7 }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Message Intelligence</div>
          <div className="page-subtitle">What wording converts best across your funnels</div>
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
          <strong style={{ color: 'var(--text)' }}>Neutral patterns detected</strong> — the following wording appears at similar rates in both your top and bottom converting funnels, meaning it does not measurably influence conversion either way:{' '}
          {neutral.map((p, i) => (
            <span key={i}><strong style={{ color: 'var(--text)' }}>{p.label}</strong>{i < neutral.length - 1 ? ', ' : ''}</span>
          ))}. Do not rely on these as conversion levers.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {[['ranking', 'M1 Rankings'], ['patterns', 'Wording Patterns']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={'btn btn-sm ' + (tab === id ? 'btn-primary' : 'btn-ghost')}
            style={{ border: 'none' }}>{label}</button>
        ))}
      </div>

      {tab === 'ranking' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="card">
            <div className="card-title">Top Converting M1 Messages</div>
            {ranked.slice(0, 7).map((f, i) => (
              <div key={f.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: i === 0 ? 'rgba(255,209,102,0.2)' : 'var(--surface2)', color: i === 0 ? 'var(--gold)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, flexShrink: 0, marginTop: 2 }}>
                  {i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13, color: 'var(--text)' }}>{f.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.5, margin: '4px 0', borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>"{f.m1_message}"</div>
                  {f.m1_cta && <div style={{ fontSize: 11, color: 'var(--accent3)', fontFamily: 'var(--mono)', marginBottom: 4 }}>CTA: "{f.m1_cta}"</div>}
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    <span style={{ color: colorFor(f.m1_ctr_pct, 30, 60), fontWeight: 700 }}>{pct(f.m1_ctr_pct)} CTR</span>
                    <span style={{ color: 'var(--muted)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--muted)' }}>{pct(f.m1_open_rate_pct)} open</span>
                    <span style={{ color: 'var(--muted)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--muted)' }}>{(f.total_sent || 0).toLocaleString()} sent</span>
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
                    <span style={{ color: 'var(--muted)' }}>{(f.total_sent || 0).toLocaleString()} sent</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'patterns' && (
        <div>
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
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                These appear in both top and bottom converters. The data shows no meaningful CTR impact either way.
              </div>
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
            <div className="card">
              <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>Not enough data yet. Add more funnels for pattern detection.</div>
            </div>
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

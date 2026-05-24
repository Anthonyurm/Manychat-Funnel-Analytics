import { useEffect, useState } from 'react'
import { getFunnels, computeOverview } from '../lib/db'
import { Spinner, pct, colorFor } from '../components/UI'

function PatternChip({ p }) {
  const isPos = (p.delta || 0) > 2
  const isNeg = (p.delta || 0) < -2
  const color = isPos ? 'var(--accent3)' : isNeg ? 'var(--accent2)' : 'var(--muted)'
  const bg = isPos ? 'rgba(92,252,157,0.08)' : isNeg ? 'rgba(252,92,125,0.08)' : 'rgba(107,107,133,0.1)'
  const sign = (p.delta || 0) > 0 ? '+' : ''
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, background: bg, border: `1px solid ${isPos ? 'rgba(92,252,157,0.25)' : isNeg ? 'rgba(252,92,125,0.25)' : 'var(--border)'}`, borderRadius: 10, padding: '10px 14px', margin: 4 }}>
      <span style={{ fontSize: 18 }}>{p.emoji}</span>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)' }}>{p.count} funnels · avg CTR {pct(p.matchedAvg)}</div>
      </div>
      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13, color, marginLeft: 4 }}>
        {p.delta != null ? sign + p.delta.toFixed(1) + 'pp' : '—'}
      </span>
    </div>
  )
}

export default function MessageIntel() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ranking')
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    getFunnels()
      .then(funnels => setData(computeOverview(funnels)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function runAI() {
    if (!data) return
    setAiLoading(true)
    setAiText('')

    const funnelRows = data.funnels
      .filter(f => f.m1_message)
      .sort((a, b) => (b.m1_ctr_pct || 0) - (a.m1_ctr_pct || 0))
      .map(f => `- "${f.m1_message}" → CTR: ${f.m1_ctr_pct ?? 'N/A'}%, Open: ${f.m1_open_rate_pct ?? 'N/A'}%, Funnel CR: ${f.funnel_cr_pct ?? 'N/A'}%`)
      .join('\n')

    const prompt = `You are a conversion copywriting expert analyzing ManyChat DM funnel performance for a music artist.

Here are all M1 (first message) variations ranked by CTR with their actual performance:

${funnelRows}

Overall averages — M1 CTR: ${data.averages.m1_ctr_pct}%, Funnel CR: ${data.averages.funnel_cr_pct}%

Analyze the MESSAGE COPY and give sharp, specific, actionable insights:
1. What specific WORDS or PHRASES in the highest-converting messages drive clicks? Quote them directly.
2. What do the LOWEST converters have in common? What to avoid?
3. What is the single most impactful wording change for the next funnel?
4. Write 2 new M1 message variations to A/B test, in the same voice and style as the existing messages.

Be specific, reference actual messages and CTR numbers. Max 350 words.`

    try {
      const resp = await fetch('/.netlify/functions/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      })

      if (!resp.ok) throw new Error('Function error')

      const text = await resp.text()
      setAiText(text)
    } catch {
      setAiText('AI analysis unavailable — make sure ANTHROPIC_API_KEY is set in Netlify environment variables (not VITE_ANTHROPIC_API_KEY).')
    }
    setAiLoading(false)
  }

  if (loading) return <Spinner />
  if (!data || data.funnels.length === 0) return (
    <div className="empty-state">
      <h3>No funnels yet</h3>
      <p>Add funnels first to see message analysis.</p>
    </div>
  )

  const { funnels, averages } = data
  const withMessages = funnels.filter(f => f.m1_message && f.m1_ctr_pct != null)
  const ranked = [...withMessages].sort((a, b) => (b.m1_ctr_pct || 0) - (a.m1_ctr_pct || 0))
  const bottom = [...withMessages].sort((a, b) => (a.m1_ctr_pct || 0) - (b.m1_ctr_pct || 0)).slice(0, 5)

  const PATTERNS = [
    { label: '"ayooo" opener', emoji: '👋', test: m => m.toLowerCase().startsWith('ayooo') },
    { label: '"thanks for liking"', emoji: '❤️', test: m => m.toLowerCase().includes('thanks for liking') },
    { label: '"i\'ll send you"', emoji: '📨', test: m => m.toLowerCase().includes("i'll send you") },
    { label: '"click below"', emoji: '👇', test: m => m.toLowerCase().includes('click below') },
    { label: '"click here"', emoji: '☝️', test: m => m.toLowerCase().includes('click here') },
    { label: 'Song title in quotes', emoji: '🎵', test: m => /[""].+[""]/.test(m) },
    { label: 'Pre-save / exclusive framing', emoji: '🔒', test: m => /before|public|early|exclusive|pre.?save/i.test(m) },
    { label: 'Short message (<60 chars)', emoji: '⚡', test: m => m.length < 60 },
    { label: 'Ends with emoji/punctuation', emoji: '✨', test: m => /[\!\)\:]+\s*$/.test(m.trim()) },
  ]

  const patterns = PATTERNS.map(p => {
    const matched = withMessages.filter(f => p.test(f.m1_message))
    const notMatched = withMessages.filter(f => !p.test(f.m1_message))
    const matchedAvg = matched.length ? matched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / matched.length : null
    const notMatchedAvg = notMatched.length ? notMatched.reduce((s, f) => s + (f.m1_ctr_pct || 0), 0) / notMatched.length : null
    const delta = matchedAvg != null && notMatchedAvg != null ? +(matchedAvg - notMatchedAvg).toFixed(1) : null
    return { ...p, count: matched.length, matchedAvg: matchedAvg ? +matchedAvg.toFixed(1) : null, notMatchedAvg: notMatchedAvg ? +notMatchedAvg.toFixed(1) : null, delta }
  }).filter(p => p.count > 0).sort((a, b) => (b.delta || 0) - (a.delta || 0))

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Message Intelligence 🧠</div>
          <div className="page-subtitle">What wording converts best — across all your funnels</div>
        </div>
        <button className="btn btn-primary" onClick={runAI} disabled={aiLoading}>
          {aiLoading ? <><span className="spinner" /> Analyzing…</> : '✦ Analyze with AI'}
        </button>
      </div>

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
            <div className="card-title">🟢 Top Converting M1 Messages</div>
            {ranked.slice(0, 7).map((f, i) => (
              <div key={f.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: i === 0 ? 'rgba(245,200,66,0.2)' : 'var(--surface2)', color: i === 0 ? 'var(--gold)' : 'var(--muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, flexShrink: 0, marginTop: 2 }}>
                  {i === 0 ? '🥇' : i + 1}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <strong style={{ fontSize: 13 }}>{f.name}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.5, marginBottom: 4, borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>"{f.m1_message}"</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    <span style={{ color: colorFor(f.m1_ctr_pct, 30, 60), fontWeight: 700 }}>{pct(f.m1_ctr_pct)} CTR</span>
                    <span style={{ color: 'var(--muted)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--muted)' }}>{pct(f.m1_open_rate_pct)} open</span>
                    <span style={{ color: 'var(--muted)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--muted)' }}>{f.total_sent?.toLocaleString()} sent</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-title">🔴 Lowest Converting M1 Messages</div>
            {bottom.map((f, i) => (
              <div key={f.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--surface2)', color: 'var(--accent2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--mono)', fontSize: 10, flexShrink: 0, marginTop: 2 }}>{i + 1}</div>
                <div style={{ flex: 1 }}>
                  <strong style={{ fontSize: 13 }}>{f.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', lineHeight: 1.5, margin: '4px 0', borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>"{f.m1_message}"</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
                    <span style={{ color: colorFor(f.m1_ctr_pct, 30, 60), fontWeight: 700 }}>{pct(f.m1_ctr_pct)} CTR</span>
                    <span style={{ color: 'var(--muted)', margin: '0 6px' }}>·</span>
                    <span style={{ color: 'var(--muted)' }}>{f.total_sent?.toLocaleString()} sent</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'patterns' && (
        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-title">📊 Wording Pattern Impact on M1 CTR</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 16 }}>
              Delta = avg CTR with pattern vs. without. Green = helps. Red = hurts.
            </div>
            <div>{patterns.map((p, i) => <PatternChip key={i} p={p} />)}</div>
          </div>

          <div className="card">
            <div className="card-title">💡 Key Takeaways</div>
            {patterns.filter(p => Math.abs(p.delta || 0) > 2).map((p, i) => {
              const isPos = (p.delta || 0) > 0
              return (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: 13, lineHeight: 1.7 }}>
                  <span style={{ color: isPos ? 'var(--accent3)' : 'var(--accent2)' }}>{isPos ? '▲' : '▼'} {p.emoji} <strong>{p.label}</strong></span>
                  {' '}— funnels using this average <strong style={{ color: isPos ? 'var(--accent3)' : 'var(--accent2)' }}>{pct(p.matchedAvg)} CTR</strong> vs {pct(p.notMatchedAvg)} without (<strong>{(p.delta > 0 ? '+' : '') + p.delta}pp</strong>)
                </div>
              )
            })}
          </div>
        </div>
      )}

      {(aiText || aiLoading) && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="card-title">
            ✦ AI Analysis
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>powered by Claude</span>
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.9, whiteSpace: 'pre-wrap' }}>
            {aiText.split('\n').map((line, i) => <div key={i}>{line || <br />}</div>)}
            {aiLoading && <span style={{ display: 'inline-block', width: 2, height: 14, background: 'var(--accent)', animation: 'blink 0.8s infinite', verticalAlign: 'middle' }} />}
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getFunnel, deleteFunnel, upsertMetric, computeOverview, getFunnels, normaliseSteps } from '../lib/db'
import { Bar, Badge, Spinner, pct, num, colorFor } from '../components/UI'

export default function FunnelDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [funnel, setFunnel] = useState(null)
  const [averages, setAverages] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [editVals, setEditVals] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([getFunnel(id), getFunnels()])
      .then(([f, all]) => {
        setFunnel(f)
        setAverages(computeOverview(all).averages)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  async function handleDelete() {
    if (!confirm('Delete this funnel? This cannot be undone.')) return
    await deleteFunnel(id)
    navigate('/')
  }

  async function saveMetric(stepId) {
    setSaving(true)
    await upsertMetric({ step_id: stepId, ...editVals, source: 'manual' })
    setEditing(null)
    const updated = await getFunnel(id)
    setFunnel(updated)
    setSaving(false)
  }

  if (loading) return <Spinner />
  if (!funnel) return <div style={{ color: 'var(--muted)' }}>Funnel not found.</div>

  const steps = funnel.steps || []
  const keywords = funnel.keywords?.map(k => k.keyword) || []

  const msgSteps = steps.filter(s => s.step_type !== 'goal').sort((a, b) => a.step_order - b.step_order)
  const goalStep = steps.find(s => s.step_type === 'goal')

  // Normalise: get effective sent/opened/clicked for every step
  const normalised = normaliseSteps(msgSteps)
  const effectiveSent = normalised[0]?.effectiveSent || null
  const wasUpdated = normalised.some(n => n.wasAdjusted)

  // Funnel CR for this funnel
  const lastN = [...normalised].reverse().find(n => n.effectiveClicked)
  const lastClicks = goalStep?.step_metrics?.[0]?.clicked || lastN?.effectiveClicked
  const thisFunnelCr = lastClicks && effectiveSent ? (lastClicks / effectiveSent * 100) : null

  // M1 stats for vs average
  const n0 = normalised[0]
  const thisM1OpenRate = n0?.effectiveOpened != null && n0?.effectiveSent
    ? (n0.effectiveOpened / n0.effectiveSent * 100)
    : null
  const thisM1Ctr = n0?.effectiveClicked != null && effectiveSent
    ? (n0.effectiveClicked / effectiveSent * 100)
    : null

  // Build a merged list: normalised message steps + goal at end
  const allDisplaySteps = [
    ...msgSteps.map((step, i) => ({ step, norm: normalised[i], isGoal: false })),
    ...(goalStep ? [{ step: goalStep, norm: null, isGoal: true }] : [])
  ]

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate('/')}>← Overview</button>
          <div className="page-title">{funnel.name} <Badge version={funnel.version} /></div>
          <div className="page-subtitle">
            {keywords.length ? `Trigger words: ${keywords.join(', ')} · ` : ''}
            {msgSteps.length} steps
            {wasUpdated && effectiveSent
              ? ` · Effective cohort: ${effectiveSent.toLocaleString()}`
              : ''}
          </div>
        </div>
        <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete Funnel</button>
      </div>

      {wasUpdated && (
        <div style={{ background: 'rgba(255,209,102,0.07)', border: '1px solid rgba(255,209,102,0.25)', borderRadius: 10, padding: '12px 18px', marginBottom: 20, fontSize: 13, color: 'var(--text)' }}>
          <strong style={{ color: 'var(--gold)' }}>Funnel updated mid-run</strong> — one or more steps show fewer entries than expected from the previous step. Numbers marked with <strong style={{ color: 'var(--gold)' }}>~</strong> have been recalculated to reflect the actual current cohort. Raw original numbers are shown in parentheses where they differ.
        </div>
      )}

      {/* Flow diagram */}
      <div className="card">
        <div className="card-title">Flow</div>
        <div className="funnel-flow">
          {allDisplaySteps.map(({ step, norm, isGoal }, i) => {
            const m = step.step_metrics?.[0]
            const isEditing = editing === step.id

            // For display: use effective values where available, else raw
            const displaySent = norm?.effectiveSent ?? m?.sent
            const displayOpened = norm?.effectiveOpened ?? m?.opened
            const displayClicked = norm?.effectiveClicked ?? m?.clicked
            const wasAdjusted = norm?.wasAdjusted || false

            // Drop-off between this step and previous
            const prevNorm = i > 0 && !isGoal ? normalised[i - 1] : null
            const prevEffectiveSent = prevNorm?.effectiveSent
            const dropPct = prevEffectiveSent && displaySent && !isGoal
              ? Math.round((1 - displaySent / prevEffectiveSent) * 100) : null

            // Cumulative CR for this step
            const cumulativeCtr = displayClicked && effectiveSent && !isGoal
              ? (displayClicked / effectiveSent * 100).toFixed(1) : null

            // Per-step open rate using effective numbers
            const perStepOpenRate = displayOpened && displaySent
              ? (displayOpened / displaySent * 100).toFixed(1) : null
            const perStepCtr = displayClicked && displaySent
              ? (displayClicked / displaySent * 100).toFixed(1) : null

            return (
              <div key={step.id} className="step-block">
                {i > 0 && (
                  <div className="step-arrow">
                    <div className="arrow-line">
                      {dropPct != null && (
                        <div style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                          -{dropPct}%
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className={'step-card' + (isGoal ? ' goal' : '')}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {isGoal ? 'Goal' : `Step ${step.step_order}`}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{step.label}</div>
                    {wasAdjusted && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--gold)', letterSpacing: 0.5 }} title="Numbers recalculated — funnel was updated mid-run">ADJUSTED</span>
                    )}
                  </div>

                  {isEditing ? (
                    <div>
                      {['sent', 'opened', 'clicked'].map(f => (
                        <div key={f} style={{ marginBottom: 6 }}>
                          <div style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 3 }}>{f}</div>
                          <input
                            style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--accent)', color: 'var(--text)', padding: '4px 8px', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 12 }}
                            type="number"
                            value={editVals[f] || ''}
                            onChange={e => setEditVals(v => ({ ...v, [f]: e.target.value ? parseInt(e.target.value) : null }))}
                          />
                        </div>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => saveMetric(step.id)} disabled={saving}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {(displaySent != null || m?.sent != null) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ color: 'var(--muted)' }}>sent</span>
                          <span>
                            {wasAdjusted ? <span style={{ color: 'var(--gold)' }}>~</span> : ''}
                            {num(displaySent)}
                            {wasAdjusted && m?.sent && m.sent !== displaySent && (
                              <span style={{ color: 'var(--muted)', fontSize: 9, marginLeft: 4 }}>({num(m.sent)} raw)</span>
                            )}
                          </span>
                        </div>
                      )}
                      {(displayOpened != null) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ color: 'var(--muted)' }}>opened</span>
                          <span>
                            {wasAdjusted ? <span style={{ color: 'var(--gold)' }}>~</span> : ''}
                            {num(displayOpened)}
                            {perStepOpenRate && <span style={{ color: 'var(--muted)', fontSize: 9, marginLeft: 4 }}>({perStepOpenRate}%)</span>}
                          </span>
                        </div>
                      )}
                      {(displayClicked != null) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ color: 'var(--muted)' }}>clicked</span>
                          <span style={{ color: colorFor(parseFloat(perStepCtr), 20, 50) }}>
                            {wasAdjusted ? <span style={{ color: 'var(--gold)' }}>~</span> : ''}
                            {num(displayClicked)}
                            {perStepCtr && <span style={{ fontSize: 9, marginLeft: 4 }}>({perStepCtr}%)</span>}
                          </span>
                        </div>
                      )}
                      {cumulativeCtr != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 0' }}>
                          <span style={{ color: 'var(--muted)' }}>cumulative CR</span>
                          <span style={{ color: colorFor(parseFloat(cumulativeCtr), 15, 40), fontWeight: 700 }}>{cumulativeCtr}%</span>
                        </div>
                      )}
                      {!m && <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>No metrics</div>}

                      {step.message_text && (
                        <div className="msg-bubble" style={{ fontSize: 11 }}>{step.message_text}</div>
                      )}

                      {!isGoal && (
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ marginTop: 10, width: '100%' }}
                          onClick={() => {
                            setEditing(step.id)
                            setEditVals({ sent: m?.sent, opened: m?.opened, clicked: m?.clicked })
                          }}>
                          Edit raw metrics
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* vs average */}
      {averages && n0 && (
        <div className="table-wrap">
          <div className="table-header"><div className="table-title">vs. Your Average</div></div>
          <table>
            <thead><tr><th>Metric</th><th>This Funnel</th><th>Your Avg</th><th>Delta</th></tr></thead>
            <tbody>
              {[
                ['M1 Open Rate', thisM1OpenRate, averages.m1_open_rate_pct],
                ['M1 CTR (cumulative)', thisM1Ctr, averages.m1_ctr_pct],
                ['Funnel CR', thisFunnelCr, averages.funnel_cr_pct],
              ].map(([label, val, avg]) => {
                const delta = val != null && avg != null ? (val - avg).toFixed(1) : null
                return (
                  <tr key={label}>
                    <td className="mono-cell">{label}</td>
                    <td style={{ fontWeight: 700, color: colorFor(val, 20, 50) }}>{pct(val)}</td>
                    <td style={{ color: 'var(--muted)' }}>{pct(avg)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: delta != null ? (parseFloat(delta) >= 0 ? 'var(--accent3)' : 'var(--accent2)') : 'var(--muted)' }}>
                      {delta != null ? (parseFloat(delta) >= 0 ? '+' : '') + delta + 'pp' : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

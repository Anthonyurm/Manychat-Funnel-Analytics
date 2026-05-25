import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getFunnel, deleteFunnel, upsertMetric, computeOverview, getFunnels, computeEffectiveSent } from '../lib/db'
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

  // Compute effective sent for this funnel using same logic as overview
  const msgSteps = steps.filter(s => s.step_type !== 'goal').sort((a, b) => a.step_order - b.step_order)
  const goalStep = steps.find(s => s.step_type === 'goal')
  const effectiveSent = computeEffectiveSent(msgSteps)

  // Funnel CR for this specific funnel: last step clicks / effectiveSent
  const lastClickedStep = goalStep || [...msgSteps].reverse().find(s => s.step_metrics?.[0]?.clicked)
  const lastClicks = lastClickedStep?.step_metrics?.[0]?.clicked
  const thisFunnelCr = lastClicks && effectiveSent ? (lastClicks / effectiveSent * 100) : null

  // M1 stats for this funnel
  const m1Step = msgSteps[0]
  const m1m = m1Step?.step_metrics?.[0]
  const thisM1OpenRate = m1m?.open_rate != null ? m1m.open_rate * 100 : null
  const thisM1Ctr = m1m?.clicked != null && effectiveSent ? (m1m.clicked / effectiveSent * 100) : null

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 12 }} onClick={() => navigate('/')}>← Overview</button>
          <div className="page-title">{funnel.name} <Badge version={funnel.version} /></div>
          <div className="page-subtitle">
            {keywords.length ? `Keywords: ${keywords.join(', ')} · ` : ''}
            {msgSteps.length} steps
            {effectiveSent && m1m?.sent && effectiveSent !== m1m.sent
              ? ` · Effective cohort: ${effectiveSent.toLocaleString()} (raw: ${m1m.sent.toLocaleString()})`
              : ''}
          </div>
        </div>
        <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete Funnel</button>
      </div>

      {/* Flow diagram */}
      <div className="card">
        <div className="card-title">Flow</div>
        <div className="funnel-flow">
          {steps.map((step, i) => {
            const m = step.step_metrics?.[0]
            const prev = i > 0 ? steps[i - 1] : null
            const prevM = prev?.step_metrics?.[0]
            const dropPct = prev && m?.sent && prevM?.sent
              ? Math.round((1 - m.sent / prevM.sent) * 100) : null
            const isGoal = step.step_type === 'goal'
            const isEditing = editing === step.id

            // Cumulative CR for this step = this step's clicked / effectiveSent
            const cumulativeCtr = m?.clicked && effectiveSent
              ? (m.clicked / effectiveSent * 100).toFixed(1) : null

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
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>{step.label}</div>

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
                      {m ? (
                        <>
                          {m.sent != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                              <span style={{ color: 'var(--muted)' }}>sent</span>
                              <span>{num(m.sent)}</span>
                            </div>
                          )}
                          {m.opened != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                              <span style={{ color: 'var(--muted)' }}>opened</span>
                              <span>{num(m.opened)} <span style={{ color: 'var(--muted)' }}>({pct(m.open_rate * 100)})</span></span>
                            </div>
                          )}
                          {m.clicked != null && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                              <span style={{ color: 'var(--muted)' }}>clicked</span>
                              <span style={{ color: colorFor(m.ctr * 100, 20, 50) }}>
                                {num(m.clicked)} <span style={{ color: 'var(--muted)', fontSize: 10 }}>(step {pct(m.ctr * 100)})</span>
                              </span>
                            </div>
                          )}
                          {cumulativeCtr != null && !isGoal && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--mono)', fontSize: 11, padding: '3px 0' }}>
                              <span style={{ color: 'var(--muted)' }}>cumulative CR</span>
                              <span style={{ color: colorFor(parseFloat(cumulativeCtr), 15, 40), fontWeight: 700 }}>{cumulativeCtr}%</span>
                            </div>
                          )}
                        </>
                      ) : <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>No metrics</div>}

                      {step.message_text && (
                        <div className="msg-bubble" style={{ fontSize: 11 }}>{step.message_text}</div>
                      )}

                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ marginTop: 10, width: '100%' }}
                        onClick={() => { setEditing(step.id); setEditVals({ sent: m?.sent, opened: m?.opened, clicked: m?.clicked }) }}>
                        Edit metrics
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* vs average — uses computed funnel CR not raw goal step ctr */}
      {averages && m1m && (
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

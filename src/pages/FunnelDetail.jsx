import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getFunnel, deleteFunnel, deleteStep, updateStep, upsertMetric, computeOverview, getFunnels, normaliseSteps } from '../lib/db'
import { Bar, Badge, Spinner, pct, num, colorFor } from '../components/UI'

export default function FunnelDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [funnel, setFunnel] = useState(null)
  const [averages, setAverages] = useState(null)
  const [overviewRow, setOverviewRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [editVals, setEditVals] = useState({})
  const [saving, setSaving] = useState(false)
  const [removingStep, setRemovingStep] = useState(null)

  useEffect(() => {
    Promise.all([getFunnel(id), getFunnels()])
      .then(([f, all]) => {
        setFunnel(f)
        const ov = computeOverview(all)
        setOverviewRow(ov.funnels.find(r => r.id === id) || null)
        // Leave one out: this funnel should not be part of the average it is
        // being measured against. With a small account that bias is large.
        const others = all.filter(f => f.id !== id)
        setAverages(others.length ? computeOverview(others).averages : null)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [id])

  async function handleDelete() {
    if (!confirm('Delete this funnel? This cannot be undone.')) return
    await deleteFunnel(id)
    navigate('/')
  }

  async function removeStep(stepId, label) {
    if (!confirm(`Remove ${label} from this funnel? The other steps renumber around it.`)) return
    setRemovingStep(stepId)
    await deleteStep(stepId)
    // Renumber what remains so labels always match positions. Without this a
    // funnel that lost M3 keeps a step labelled M4 sitting in the M3 column.
    let updated = await getFunnel(id)
    const remaining = (updated.steps || [])
      .filter(st => st.step_type !== 'goal')
      .sort((a, b) => a.step_order - b.step_order)
    for (let i = 0; i < remaining.length; i++) {
      const wantOrder = i + 1
      const wantLabel = `M${i + 1}`
      if (remaining[i].step_order !== wantOrder || remaining[i].label !== wantLabel) {
        await updateStep(remaining[i].id, { step_order: wantOrder, label: wantLabel })
      }
    }
    updated = await getFunnel(id)
    setFunnel(updated)
    setRemovingStep(null)
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
  const effectiveSent = normalised[0]?.effectiveSent ?? null
  const wasUpdated = normalised.some(n => n.wasAdjusted)
  const chainValid = normalised[0]?.chainValid !== false
  const chainIssues = normalised[0]?.chainIssues || []
  const badStepIndexes = new Set(chainIssues.map(i => i.at))

  // The dashboard's figure, computed once in computeOverview, so the two
  // screens can never disagree about the same funnel again
  const thisFunnelCr = overviewRow?.funnel_cr_pct ?? null

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

      {!chainValid && (
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.30)', borderRadius: 10, padding: '14px 18px', marginBottom: 20, fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 600, color: 'var(--gold)', marginBottom: 8 }}>
            One of these steps came from a different branch
          </div>
          {chainIssues.map((iss, i) => <div key={i} style={{ color: 'var(--muted)', fontSize: 12 }}>{iss.detail}</div>)}
          <div style={{ marginTop: 8 }}>
            The offending step is outlined below. Remove it and the numbers correct themselves. Until then this funnel stays out of your averages.
          </div>
        </div>
      )}

      {chainValid && wasUpdated && (
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '12px 18px', marginBottom: 20, fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
          You edited this funnel while it was running, so the early steps carry people who never saw the current version. Anything marked with a <span style={{ color: 'var(--gold)' }}>~</span> has been recalculated down to the cohort that actually went through it, with the original figure in brackets beside it.
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

            // Drop off between this step and previous
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
                <div className={'step-card' + (isGoal ? ' goal' : '')}
                  style={badStepIndexes.has(i + 1) ? { borderColor: 'var(--gold)', boxShadow: '0 0 0 1px var(--gold)' } : undefined}>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {isGoal ? 'Goal' : `Step ${step.step_order}`}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{step.label}</div>
                    {wasAdjusted && (
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--gold)', letterSpacing: 0.5 }} title="Numbers recalculated. This funnel was updated mid run.">ADJUSTED</span>
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
                          <span style={{ color: 'var(--muted)' }} title="Out of everyone who entered the funnel, the share that made it this far and clicked">still in from the start</span>
                          <span style={{ color: colorFor(parseFloat(cumulativeCtr), 15, 40), fontWeight: 700 }}>{cumulativeCtr}%</span>
                        </div>
                      )}
                      {!m && <div style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11 }}>No metrics</div>}

                      {step.message_text && (
                        <div className="msg-bubble" style={{ fontSize: 11 }}>{step.message_text}</div>
                      )}

                      {!isGoal && (
                        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          style={{ flex: 1 }}
                          onClick={() => {
                            setEditing(step.id)
                            setEditVals({ sent: m?.sent, opened: m?.opened, clicked: m?.clicked })
                          }}>
                          Edit numbers
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          title="Remove this step from the funnel"
                          disabled={removingStep === step.id}
                          onClick={() => removeStep(step.id, step.label)}>
                          {removingStep === step.id ? '...' : 'Remove'}
                        </button>
                        </div>
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
      {averages && n0 && chainValid && (
        <div className="table-wrap">
          <div className="table-header"><div className="table-title">Against your other funnels</div></div>
          <table>
            <thead><tr><th>Metric</th><th>This funnel</th><th>Others average</th><th>Gap</th></tr></thead>
            <tbody>
              {[
                ['First message opened', thisM1OpenRate, averages.m1_open_rate_pct],
                ['First message clicked', thisM1Ctr, averages.m1_ctr_pct],
                ['Finish rate', thisFunnelCr, averages.funnel_cr_pct],
              ].map(([label, val, avg]) => {
                const delta = val != null && avg != null ? (val - avg).toFixed(1) : null
                return (
                  <tr key={label}>
                    <td className="mono-cell">{label}</td>
                    <td style={{ fontWeight: 700, color: colorFor(val, 20, 50) }}>{pct(val)}</td>
                    <td style={{ color: 'var(--muted)' }}>{pct(avg)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: delta != null ? (parseFloat(delta) >= 0 ? 'var(--accent3)' : 'var(--accent2)') : 'var(--muted)' }}>
                      {delta != null ? (parseFloat(delta) >= 0 ? '+' : '') + delta + 'pp' : 'n/a'}
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

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFunnels, computeOverview, deleteFunnel, updateFunnel } from '../lib/db'
import { Bar, Badge, Spinner, StatCard, ThWithTip, pct, num, VERSIONS } from '../components/UI'

const TIPS = {
  name: 'The name of this funnel or automation',
  version: 'The type of funnel — Song Out Now, Pre-Release, New Follower Automation, etc.',
  open: 'Percentage of people who opened this message out of those it was sent to',
  ctr: 'Click-through rate — percentage who clicked the CTA button in this message',
  cr: 'End-to-end conversion rate using effective sent (reverse-engineered to account for mid-run funnel updates)',
  vol: 'Raw number of people sent the first message — may include people from an older version of the funnel',
}

function PatternSummary({ funnels, versionFilter }) {
  if (funnels.length < 3) return null
  const withCr = funnels.filter(f => f.funnel_cr_pct != null && f.m1_ctr_pct != null)
  if (withCr.length < 2) return null

  const sorted = [...withCr].sort((a, b) => b.funnel_cr_pct - a.funnel_cr_pct)
  const topHalf = sorted.slice(0, Math.ceil(sorted.length / 2))
  const bottomHalf = sorted.slice(Math.ceil(sorted.length / 2))

  const avgTop = topHalf.reduce((s, f) => s + f.funnel_cr_pct, 0) / topHalf.length
  const avgBot = bottomHalf.reduce((s, f) => s + f.funnel_cr_pct, 0) / bottomHalf.length
  const gap = (avgTop - avgBot).toFixed(1)

  const topM1 = topHalf.filter(f => f.m1_ctr_pct)
  const botM1 = bottomHalf.filter(f => f.m1_ctr_pct)
  const avgTopM1 = topM1.reduce((s, f) => s + f.m1_ctr_pct, 0) / (topM1.length || 1)
  const avgBotM1 = botM1.reduce((s, f) => s + f.m1_ctr_pct, 0) / (botM1.length || 1)
  const m1Gap = topM1.length && botM1.length ? (avgTopM1 - avgBotM1).toFixed(1) : null

  const topNames = topHalf.slice(0, 3).map(f => f.name).join(', ')
  const botNames = bottomHalf.slice(0, 3).map(f => f.name).join(', ')
  const scope = versionFilter === 'all' ? 'across all funnel types' : `in your ${versionFilter} funnels`

  const insights = []

  if (parseFloat(gap) > 5) {
    insights.push(`Your top converters (${topNames}) average ${avgTop.toFixed(1)}% CR vs ${avgBot.toFixed(1)}% for your lowest (${botNames}) — a ${gap}pp gap ${scope}. This spread is large enough to act on.`)
  } else {
    insights.push(`Your top and bottom converters are within ${gap}pp of each other ${scope}. Performance is relatively consistent, which means small optimizations at each step will compound.`)
  }

  if (m1Gap && parseFloat(m1Gap) > 10) {
    insights.push(`M1 click-through rate differs by ${m1Gap}pp between your top and bottom funnels. Your first message is the biggest lever — rewriting your lowest M1 messages to match the style and structure of your top converters is the highest-priority test right now.`)
  } else if (m1Gap && parseFloat(m1Gap) > 3) {
    insights.push(`M1 CTR differs by ${m1Gap}pp between your top and bottom performers. There is a meaningful gap — review the message copy in Message Intelligence to identify which specific words and structures are driving the difference.`)
  } else if (m1Gap) {
    insights.push(`M1 CTR is similar across top and bottom performers (${m1Gap}pp gap). The drop-off is happening later in the funnel — look at M2 and beyond for the biggest optimization opportunity.`)
  }

  const topWithQuote = topHalf.filter(f => f.m1_message && /[""].+[""]/.test(f.m1_message)).length
  const botWithQuote = bottomHalf.filter(f => f.m1_message && /[""].+[""]/.test(f.m1_message)).length
  if (topWithQuote / topHalf.length > 0.6 && botWithQuote / bottomHalf.length < 0.4) {
    insights.push(`Most top converters include the song title in quotes in the first message. Most bottom converters do not. Test adding the song name explicitly to your next M1 message.`)
  }

  const topShort = topHalf.filter(f => f.m1_message && f.m1_message.length < 70).length
  const botShort = bottomHalf.filter(f => f.m1_message && f.m1_message.length < 70).length
  if (topShort / topHalf.length > 0.6 && botShort / bottomHalf.length < 0.4) {
    insights.push(`Top converting M1 messages tend to be shorter (under 70 characters). Bottom performers use longer copy. Test trimming to one clear sentence with a direct CTA.`)
  }

  insights.push(`Next recommended test: take your lowest converting funnel and rewrite its M1 message using the structure of your #1 converter. Run them in parallel for 7 days to measure the impact.`)

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, marginBottom: 24 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 16 }}>
        Pattern Analysis {versionFilter !== 'all' ? `— ${versionFilter}` : '— All Types'}
      </div>
      {insights.map((text, i) => (
        <div key={i} style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text)', padding: '10px 0', borderBottom: i < insights.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', gap: 12 }}>
          <span style={{ color: 'var(--accent)', fontFamily: 'var(--mono)', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{i + 1}.</span>
          <span>{text}</span>
        </div>
      ))}
    </div>
  )
}

export default function Overview() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState({ key: 'funnel_cr_pct', dir: 'desc' })
  const [versionFilter, setVersionFilter] = useState('all')
  const [editingId, setEditingId] = useState(null)
  const [editVals, setEditVals] = useState({})
  const [deletingId, setDeletingId] = useState(null)
  const navigate = useNavigate()

  const load = useCallback(() => {
    setLoading(true)
    getFunnels()
      .then(funnels => setData(computeOverview(funnels)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  function toggleSort(key) {
    setSort(s => ({ key, dir: s.key === key ? (s.dir === 'desc' ? 'asc' : 'desc') : 'desc' }))
  }

  async function handleDelete(e, id) {
    e.stopPropagation()
    if (!confirm('Delete this funnel? This cannot be undone.')) return
    setDeletingId(id)
    await deleteFunnel(id)
    setDeletingId(null)
    load()
  }

  async function saveEdit(id) {
    await updateFunnel(id, editVals)
    setEditingId(null)
    load()
  }

  if (loading) return <Spinner />
  if (!data) return null

  const { funnels, maxSteps, buildAverages, versions } = data
  const filtered = versionFilter === 'all' ? funnels : funnels.filter(f => f.version === versionFilter)
  const averages = buildAverages(versionFilter === 'all' ? null : versionFilter)

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sort.dir === 'asc' ? av - bv : bv - av
  })

  const totalVol = filtered.reduce((s, f) => s + (f.total_sent || 0), 0)
  const best = [...filtered].filter(f => f.funnel_cr_pct != null).sort((a, b) => b.funnel_cr_pct - a.funnel_cr_pct)[0]
  const bestM1 = [...filtered].filter(f => f.m1_ctr_pct).sort((a, b) => b.m1_ctr_pct - a.m1_ctr_pct)[0]
  const sp = { key: sort.key, dir: sort.dir }

  const stepCols = []
  for (let i = 1; i <= maxSteps; i++) {
    stepCols.push({ openKey: `m${i}_open_rate_pct`, ctrKey: `m${i}_ctr_pct`, label: `M${i}` })
  }

  if (funnels.length === 0) return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Overview</div></div>
        <button className="btn btn-primary" onClick={() => navigate('/funnels/new')}>+ Add First Funnel</button>
      </div>
      <div className="empty-state">
        <h3>No funnels yet</h3>
        <p>Add your first funnel via CSV, manually, or screenshot.</p>
        <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => navigate('/funnels/new')}>+ Add Funnel</button>
      </div>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Overview</div>
          <div className="page-subtitle">Cross-funnel performance — hover columns for definitions, click to sort</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="version-filter">
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Filter:</span>
            <select value={versionFilter} onChange={e => setVersionFilter(e.target.value)}>
              <option value="all">All Types</option>
              {versions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/funnels/new')}>+ Add Funnel</button>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Avg M1 Open Rate" value={averages.m1_open_rate_pct ?? '—'} unit="%" delta="opened / sent" />
        <StatCard label="Avg M1 CTR" value={averages.m1_ctr_pct ?? '—'} unit="%" delta="clicked / sent" />
        <StatCard label="Avg M2 CTR" value={averages.m2_ctr_pct ?? '—'} unit="%" delta="follow-up step" />
        <StatCard label="Avg Funnel CR" value={averages.funnel_cr_pct ?? '—'} unit="%" delta="end-to-end" />
        <StatCard label="Total Volume" value={totalVol.toLocaleString()} unit="" delta="raw entries — may include old cohorts" />
      </div>

      <PatternSummary funnels={filtered} versionFilter={versionFilter} />

      {best && bestM1 && (
        <div className="insight">
          <strong>{best.name}</strong> is your top-converting funnel at <strong>{best.funnel_cr_pct}% CR</strong>.{' '}
          <strong>{bestM1.name}</strong> leads M1 CTR at <strong>{bestM1.m1_ctr_pct}%</strong>
          {bestM1.m1_ctr_pct > (averages.m1_ctr_pct || 0)
            ? ` — ${(bestM1.m1_ctr_pct - averages.m1_ctr_pct).toFixed(1)}pp above average.`
            : '.'}
          {' '}<span style={{ color: 'var(--muted)' }}>Go to Message Intelligence for a detailed wording breakdown.</span>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-header">
          <div className="table-title">{versionFilter === 'all' ? 'All Funnels' : versionFilter} — {filtered.length} total</div>
          <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              {/* Actions — far left */}
              <th style={{ width: 56 }}></th>
              <th style={{ width: 32 }}></th>
              <ThWithTip label="Funnel" tip={TIPS.name} sortKey="name" sortState={sp} onSort={toggleSort} />
              <ThWithTip label="Type" tip={TIPS.version} sortKey="version" sortState={sp} onSort={toggleSort} />
              {stepCols.map(col => (
                <>
                  <ThWithTip key={col.openKey} label={`${col.label} Open`} tip={`${col.label} — ${TIPS.open}`} sortKey={col.openKey} sortState={sp} onSort={toggleSort} />
                  <ThWithTip key={col.ctrKey} label={`${col.label} CTR`} tip={`${col.label} — ${TIPS.ctr}`} sortKey={col.ctrKey} sortState={sp} onSort={toggleSort} />
                </>
              ))}
              <ThWithTip label="Funnel CR" tip={TIPS.cr} sortKey="funnel_cr_pct" sortState={sp} onSort={toggleSort} />
              <ThWithTip label="Volume" tip={TIPS.vol} sortKey="total_sent" sortState={sp} onSort={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {/* Averages row */}
            <tr className="avg-row">
              <td></td><td></td>
              <td className="name-cell">AVG {versionFilter !== 'all' ? `(${versionFilter})` : ''}</td>
              <td></td>
              {stepCols.map(col => (
                <>
                  <td key={col.openKey}><Bar val={averages[col.openKey]} low={40} high={70} /></td>
                  <td key={col.ctrKey}><Bar val={averages[col.ctrKey]} low={30} high={60} /></td>
                </>
              ))}
              <td><Bar val={averages.funnel_cr_pct} low={15} high={40} /></td>
              <td className="mono-cell">{num(Math.round(averages.total_sent))}</td>
            </tr>

            {sorted.map((f, i) => (
              <tr key={f.id} onClick={() => editingId !== f.id && navigate(`/funnels/${f.id}`)}>
                {/* Actions — far left, icon-only */}
                <td onClick={e => e.stopPropagation()} style={{ width: 56 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '3px 7px', fontSize: 12 }}
                      title="Edit name and type"
                      onClick={() => { setEditingId(f.id); setEditVals({ name: f.name, version: f.version }) }}>
                      ✏
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      style={{ padding: '3px 7px', fontSize: 12 }}
                      title="Delete funnel"
                      disabled={deletingId === f.id}
                      onClick={e => handleDelete(e, f.id)}>
                      {deletingId === f.id ? '…' : '✕'}
                    </button>
                  </div>
                </td>

                <td><span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 11 }}>#{i + 1}</span></td>

                {/* Editable name */}
                <td className="name-cell" onClick={e => e.stopPropagation()}>
                  {editingId === f.id ? (
                    <div className="inline-edit-wrap">
                      <input className="inline-edit-input" value={editVals.name || ''} onChange={e => setEditVals(v => ({ ...v, name: e.target.value }))} autoFocus />
                      <button className="btn btn-primary btn-sm" onClick={() => saveEdit(f.id)}>Save</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  ) : <span>{f.name}</span>}
                </td>

                {/* Editable version */}
                <td onClick={e => e.stopPropagation()}>
                  {editingId === f.id ? (
                    <select className="form-input" style={{ padding: '4px 8px', fontSize: 12 }} value={editVals.version || ''} onChange={e => setEditVals(v => ({ ...v, version: e.target.value }))}>
                      {VERSIONS.map(v => <option key={v}>{v}</option>)}
                    </select>
                  ) : <Badge version={f.version} />}
                </td>

                {stepCols.map(col => (
                  <>
                    <td key={col.openKey}><Bar val={f[col.openKey]} low={40} high={70} /></td>
                    <td key={col.ctrKey}><Bar val={f[col.ctrKey]} low={30} high={60} /></td>
                  </>
                ))}

                <td><Bar val={f.funnel_cr_pct} low={15} high={40} /></td>
                <td className="mono-cell" style={{ color: 'var(--muted)' }}>{num(f.total_sent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

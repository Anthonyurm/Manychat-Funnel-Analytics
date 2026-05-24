import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFunnels, computeOverview, deleteFunnel, updateFunnel } from '../lib/db'
import { Bar, Badge, Spinner, StatCard, ThWithTip, pct, num, colorFor, VERSIONS } from '../components/UI'

const COLUMN_TIPS = {
  name: 'The name of this funnel or automation',
  version: 'The type of funnel — Song Out Now, Pre-Release, New Follower, etc.',
  keywords: 'The trigger words that start this ManyChat automation',
  open_rate: 'Percentage of people who opened the message out of those it was sent to',
  ctr: 'Click-through rate — percentage who clicked the CTA button in this message',
  funnel_cr: 'End-to-end conversion rate: final clicks ÷ effective sent (reverse-engineered from last step)',
  volume: 'Total number of people sent the first message in this funnel',
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

  async function handleDelete(e, funnelId) {
    e.stopPropagation()
    if (!confirm('Delete this funnel? This cannot be undone.')) return
    setDeletingId(funnelId)
    await deleteFunnel(funnelId)
    setDeletingId(null)
    load()
  }

  async function saveEdit(funnelId) {
    await updateFunnel(funnelId, editVals)
    setEditingId(null)
    load()
  }

  if (loading) return <Spinner />
  if (!data) return null

  const { funnels, maxSteps, buildAverages, versions } = data
  const filteredFunnels = versionFilter === 'all' ? funnels : funnels.filter(f => f.version === versionFilter)
  const averages = buildAverages(versionFilter === 'all' ? null : versionFilter)

  const sorted = [...filteredFunnels].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sort.dir === 'asc' ? av - bv : bv - av
  })

  const totalVol = filteredFunnels.reduce((s, f) => s + (f.total_sent || 0), 0)
  const best = [...filteredFunnels].filter(f => f.funnel_cr_pct != null).sort((a, b) => b.funnel_cr_pct - a.funnel_cr_pct)[0]
  const bestM1 = [...filteredFunnels].filter(f => f.m1_ctr_pct).sort((a, b) => b.m1_ctr_pct - a.m1_ctr_pct)[0]

  const sp = { key: sort.key, dir: sort.dir }

  const stepCols = []
  for (let i = 1; i <= maxSteps; i++) {
    stepCols.push({ openKey: `m${i}_open_rate_pct`, ctrKey: `m${i}_ctr_pct`, label: `M${i}` })
  }

  if (funnels.length === 0) return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Overview ⚡</div></div>
        <button className="btn btn-primary" onClick={() => navigate('/funnels/new')}>＋ Add First Funnel</button>
      </div>
      <div className="empty-state">
        <h3>No funnels yet</h3>
        <p>Add your first funnel via CSV, manually, or screenshot.</p>
        <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => navigate('/funnels/new')}>＋ Add Funnel</button>
      </div>
    </div>
  )

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Overview ⚡</div>
          <div className="page-subtitle">Cross-funnel performance · hover columns for info · click to sort</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="version-filter">
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Filter:</span>
            <select value={versionFilter} onChange={e => setVersionFilter(e.target.value)}>
              <option value="all">All Types</option>
              {versions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/funnels/new')}>＋ Add Funnel</button>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Avg M1 Open Rate" value={averages.m1_open_rate_pct ?? '—'} unit="%" delta="opened / sent" />
        <StatCard label="Avg M1 CTR" value={averages.m1_ctr_pct ?? '—'} unit="%" delta="clicked / sent" />
        <StatCard label="Avg M2 CTR" value={averages.m2_ctr_pct ?? '—'} unit="%" delta="follow-up step" />
        <StatCard label="Avg Funnel CR" value={averages.funnel_cr_pct ?? '—'} unit="%" delta="end-to-end" />
        <StatCard label="Total Volume" value={totalVol.toLocaleString()} unit="" delta="people entered flows" />
      </div>

      {best && bestM1 && (
        <div className="insight">
          🔍 <strong>{best.name}</strong> is your top-converting funnel at <strong>{best.funnel_cr_pct}% CR</strong>.{' '}
          <strong>{bestM1.name}</strong> wins M1 CTR at <strong>{bestM1.m1_ctr_pct}%</strong>
          {bestM1.m1_ctr_pct > (averages.m1_ctr_pct || 0)
            ? ` — ${(bestM1.m1_ctr_pct - averages.m1_ctr_pct).toFixed(1)}pp above your ${versionFilter !== 'all' ? versionFilter + ' ' : ''}average.`
            : '.'}
          {' '}<span style={{ color: 'var(--muted)' }}>→ Head to <strong style={{ color: 'var(--accent)' }}>Message Intel</strong> to see which wording patterns drive those results.</span>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-header">
          <div className="table-title">
            {versionFilter === 'all' ? 'All Funnels' : versionFilter} — {filteredFunnels.length} total
          </div>
          <button className="btn btn-ghost btn-sm" onClick={load}>↺ Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              <th></th>
              <ThWithTip label="Funnel" tip={COLUMN_TIPS.name} sortKey="name" sortState={sp} onSort={toggleSort} />
              <ThWithTip label="Type" tip={COLUMN_TIPS.version} sortKey="version" sortState={sp} onSort={toggleSort} />
              <th>Trigger Words</th>
              {stepCols.map(col => (
                <>
                  <ThWithTip key={col.openKey} label={`${col.label} Open`} tip={`${col.label} open rate — ${COLUMN_TIPS.open_rate}`} sortKey={col.openKey} sortState={sp} onSort={toggleSort} />
                  <ThWithTip key={col.ctrKey} label={`${col.label} CTR`} tip={`${col.label} click-through rate — ${COLUMN_TIPS.ctr}`} sortKey={col.ctrKey} sortState={sp} onSort={toggleSort} />
                </>
              ))}
              <ThWithTip label="Funnel CR" tip={COLUMN_TIPS.funnel_cr} sortKey="funnel_cr_pct" sortState={sp} onSort={toggleSort} />
              <ThWithTip label="Volume" tip={COLUMN_TIPS.volume} sortKey="total_sent" sortState={sp} onSort={toggleSort} />
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr className="avg-row">
              <td></td>
              <td className="name-cell">AVG {versionFilter !== 'all' ? `(${versionFilter})` : ''}</td>
              <td></td>
              <td></td>
              {stepCols.map(col => (
                <>
                  <td key={col.openKey}><Bar val={averages[col.openKey]} low={40} high={70} /></td>
                  <td key={col.ctrKey}><Bar val={averages[col.ctrKey]} low={30} high={60} /></td>
                </>
              ))}
              <td><Bar val={averages.funnel_cr_pct} low={15} high={40} /></td>
              <td className="mono-cell">{num(Math.round(averages.total_sent))}</td>
              <td></td>
            </tr>

            {sorted.map((f, i) => (
              <tr key={f.id} onClick={() => editingId !== f.id && navigate(`/funnels/${f.id}`)}>
                <td><span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 11 }}>#{i + 1}</span></td>

                <td className="name-cell" onClick={e => e.stopPropagation()}>
                  {editingId === f.id ? (
                    <div className="inline-edit-wrap">
                      <input className="inline-edit-input" value={editVals.name || ''} onChange={e => setEditVals(v => ({ ...v, name: e.target.value }))} autoFocus />
                      <button className="btn btn-primary btn-sm" onClick={() => saveEdit(f.id)}>✓</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditingId(null)}>✗</button>
                    </div>
                  ) : (
                    <span title="Click ✏ to edit">{f.name}</span>
                  )}
                </td>

                <td onClick={e => e.stopPropagation()}>
                  {editingId === f.id ? (
                    <select className="form-input" style={{ padding: '4px 8px', fontSize: 12 }} value={editVals.version || ''} onChange={e => setEditVals(v => ({ ...v, version: e.target.value }))}>
                      {VERSIONS.map(v => <option key={v}>{v}</option>)}
                    </select>
                  ) : (
                    <Badge version={f.version} />
                  )}
                </td>

                <td className="mono-cell" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                  {f.keywords.join(', ') || '—'}
                </td>

                {stepCols.map(col => (
                  <>
                    <td key={col.openKey}><Bar val={f[col.openKey]} low={40} high={70} /></td>
                    <td key={col.ctrKey}><Bar val={f[col.ctrKey]} low={30} high={60} /></td>
                  </>
                ))}

                <td><Bar val={f.funnel_cr_pct} low={15} high={40} /></td>
                <td className="mono-cell" style={{ color: 'var(--muted)' }}>{num(f.total_sent)}</td>

                <td onClick={e => e.stopPropagation()}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setEditingId(f.id); setEditVals({ name: f.name, version: f.version }) }}>✏</button>
                    <button className="btn btn-danger btn-sm" disabled={deletingId === f.id} onClick={e => handleDelete(e, f.id)}>
                      {deletingId === f.id ? '…' : '✕'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

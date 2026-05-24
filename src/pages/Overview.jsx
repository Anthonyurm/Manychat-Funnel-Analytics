import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFunnels, computeOverview } from '../lib/db'
import { Bar, Badge, Spinner, StatCard, pct, num, colorFor } from '../components/UI'

export default function Overview() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState({ key: 'funnel_cr_pct', dir: 'desc' })
  const navigate = useNavigate()

  useEffect(() => {
    getFunnels()
      .then(funnels => setData(computeOverview(funnels)))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  function toggleSort(key) {
    setSort(s => ({ key, dir: s.key === key ? (s.dir === 'desc' ? 'asc' : 'desc') : 'desc' }))
  }

  function arrow(key) {
    if (sort.key !== key) return <span className="sort-arrow">↕</span>
    return <span className="sort-arrow" style={{ opacity: 1, color: 'var(--accent)' }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>
  }

  if (loading) return <Spinner />
  if (!data) return null

  const { funnels, averages } = data

  if (funnels.length === 0) return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Overview ⚡</div><div className="page-subtitle">No funnels yet</div></div>
        <button className="btn btn-primary" onClick={() => navigate('/funnels/new')}>＋ Add First Funnel</button>
      </div>
      <div className="empty-state">
        <h3>No funnels yet</h3>
        <p>Add your first funnel via CSV, manually, or screenshot.</p>
        <button className="btn btn-primary" style={{ marginTop: 20 }} onClick={() => navigate('/funnels/new')}>＋ Add Funnel</button>
      </div>
    </div>
  )

  const sorted = [...funnels].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sort.dir === 'asc' ? av - bv : bv - av
  })

  const totalVol = funnels.reduce((s, f) => s + (f.total_sent || 0), 0)
  const best = [...funnels].sort((a, b) => (b.funnel_cr_pct || 0) - (a.funnel_cr_pct || 0))[0]
  const bestM1 = [...funnels].filter(f => f.m1_ctr_pct).sort((a, b) => b.m1_ctr_pct - a.m1_ctr_pct)[0]

  const th = (key, label) => (
    <th className={'sortable' + (sort.key === key ? ' sorted' : '')} onClick={() => toggleSort(key)}>
      {label} {arrow(key)}
    </th>
  )

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Overview ⚡</div>
          <div className="page-subtitle">Cross-funnel performance · click any column to sort</div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/funnels/new')}>＋ Add Funnel</button>
      </div>

      {/* Stat cards */}
      <div className="stat-grid">
        <StatCard label="Avg Open Rate" value={averages.m1_open_rate_pct ?? '—'} unit="%" delta="M1 across all funnels" />
        <StatCard label="Avg M1 CTR" value={averages.m1_ctr_pct ?? '—'} unit="%" delta="clicked / sent" />
        <StatCard label="Avg M2 CTR" value={averages.m2_ctr_pct ?? '—'} unit="%" delta="follow-up step" />
        <StatCard label="Avg Funnel CR" value={averages.funnel_cr_pct ?? '—'} unit="%" delta="end-to-end" />
        <StatCard label="Total Volume" value={totalVol.toLocaleString()} unit="" delta="people entered flows" />
      </div>

      {/* Insight */}
      {best && bestM1 && (
        <div className="insight">
          🔍 <strong>{best.name}</strong> is your top-converting funnel at <strong>{best.funnel_cr_pct}% CR</strong>.{' '}
          <strong>{bestM1.name}</strong> wins M1 CTR at <strong>{bestM1.m1_ctr_pct}%</strong>
          {bestM1.m1_ctr_pct > averages.m1_ctr_pct
            ? ` — that's ${(bestM1.m1_ctr_pct - averages.m1_ctr_pct).toFixed(1)}pp above your average.`
            : '.'}
          {' '}<span style={{ color: 'var(--muted)' }}>→ Head to <strong style={{ color: 'var(--accent)' }}>Message Intel</strong> to see which wording patterns drive those results.</span>
        </div>
      )}

      {/* Sortable table */}
      <div className="table-wrap">
        <div className="table-header">
          <div className="table-title">All Funnels — {funnels.length} total</div>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Click any column header to sort ↕</div>
        </div>
        <table>
          <thead>
            <tr>
              <th></th>
              {th('name', 'Funnel')}
              {th('version', 'Version')}
              <th>Keywords</th>
              {th('m1_open_rate_pct', 'M1 Open')}
              {th('m1_ctr_pct', 'M1 CTR')}
              {th('m2_ctr_pct', 'M2 CTR')}
              {th('funnel_cr_pct', 'Funnel CR')}
              {th('total_sent', 'Volume')}
            </tr>
          </thead>
          <tbody>
            {/* Averages row */}
            <tr className="avg-row">
              <td></td>
              <td className="name-cell">AVG</td>
              <td></td>
              <td></td>
              <td><Bar val={averages.m1_open_rate_pct} low={40} high={70} /></td>
              <td><Bar val={averages.m1_ctr_pct} low={30} high={60} /></td>
              <td><Bar val={averages.m2_ctr_pct} low={30} high={60} /></td>
              <td><Bar val={averages.funnel_cr_pct} low={15} high={40} /></td>
              <td className="mono-cell">{num(Math.round(averages.total_sent))}</td>
            </tr>
            {sorted.map((f, i) => (
              <tr key={f.id} onClick={() => navigate(`/funnels/${f.id}`)}>
                <td><span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 11 }}>#{i + 1}</span></td>
                <td className="name-cell">{f.name}</td>
                <td><Badge version={f.version} /></td>
                <td className="mono-cell" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.keywords.join(', ') || '—'}
                </td>
                <td><Bar val={f.m1_open_rate_pct} low={40} high={70} /></td>
                <td><Bar val={f.m1_ctr_pct} low={30} high={60} /></td>
                <td><Bar val={f.m2_ctr_pct} low={30} high={60} /></td>
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

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { getFunnels, computeOverview, deleteFunnel, updateFunnel } from '../lib/db'
import { Bar, Badge, Spinner, StatCard, pct, num, VERSIONS } from '../components/UI'

function PatternSummary({ funnels, versionFilter }) {
  const withCr = funnels.filter(f => f.funnel_cr_pct != null && f.m1_ctr_pct != null)
  // Three a side. Below that the app is comparing one funnel to one funnel
  // and calling the result a pattern.
  if (withCr.length < 6) return null

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
    insights.push(`${topNames} convert at ${avgTop.toFixed(1)}% against ${avgBot.toFixed(1)}% for ${botNames}, a ${gap} point gap ${scope}. That is a wide enough spread to be worth copying from the top group.`)
  } else {
    insights.push(`Your best and worst funnels sit within ${gap} points of each other ${scope}. Nothing here is broken, so gains will come from small improvements at each step rather than fixing one bad funnel.`)
  }

  if (m1Gap && parseFloat(m1Gap) > 10) {
    insights.push(`First message clicked rate differs by ${m1Gap} points between your best and worst funnels. That is where the money is. Rewrite the weakest openers to match how your top funnels start.`)
  } else if (m1Gap && parseFloat(m1Gap) > 3) {
    insights.push(`First message clicked rate differs by ${m1Gap} points between your best and worst funnels. Message Intelligence will show you which words separate them.`)
  } else if (m1Gap) {
    insights.push(`First message clicked rate is nearly identical across your best and worst funnels, a gap of only ${m1Gap} points. Whatever separates them happens after M1, so look further down the flow.`)
  }

  const QUOTED = /["\u201C\u201D'].+["\u201C\u201D']/
  const topWithQuote = topHalf.filter(f => f.m1_message && QUOTED.test(f.m1_message)).length
  const botWithQuote = bottomHalf.filter(f => f.m1_message && QUOTED.test(f.m1_message)).length
  if (topWithQuote / topHalf.length > 0.6 && botWithQuote / bottomHalf.length < 0.4) {
    insights.push(`Your better funnels tend to name the song in quotes in the first message and the weaker ones do not. Worth naming it explicitly next time.`)
  }

  const topShort = topHalf.filter(f => f.m1_message && f.m1_message.length < 70).length
  const botShort = bottomHalf.filter(f => f.m1_message && f.m1_message.length < 70).length
  if (topShort / topHalf.length > 0.6 && botShort / bottomHalf.length < 0.4) {
    insights.push(`Your better openers run under 70 characters and the weaker ones run long. Try cutting the next one to a single sentence.`)
  }

  // Only recommend an M1 rewrite when M1 is actually where the gap is. The old
  // version fired unconditionally, contradicting the line directly above it.
  if (m1Gap && parseFloat(m1Gap) > 3) {
    insights.push(`If you only change one thing this week, rewrite the first message on ${botNames.split(',')[0]} using the structure from ${topNames.split(',')[0]}, then give it seven days.`)
  }

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, marginBottom: 24 }}>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 16 }}>
        Pattern Analysis {versionFilter !== 'all' ? `: ${versionFilter}` : ': All Types'}
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

  const { funnels, clean, maxSteps, buildAverages, versions } = data
  const filtered = versionFilter === 'all' ? funnels : funnels.filter(f => f.version === versionFilter)
  // Insight and pattern blocks read only from funnels that parsed into a valid
  // path. The table below still lists everything so problems stay visible.
  const filteredClean = versionFilter === 'all' ? clean : clean.filter(f => f.version === versionFilter)
  const averages = buildAverages(versionFilter === 'all' ? null : versionFilter)

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sort.key], bv = b[sort.key]
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    return sort.dir === 'asc' ? av - bv : bv - av
  })

  const totalVol = filteredClean.reduce((s, f) => s + (f.effective_sent || f.total_sent || 0), 0)
  const best = [...filteredClean].filter(f => f.funnel_cr_pct != null).sort((a, b) => b.funnel_cr_pct - a.funnel_cr_pct)[0]
  const bestM1 = [...filteredClean].filter(f => f.m1_ctr_pct).sort((a, b) => b.m1_ctr_pct - a.m1_ctr_pct)[0]
  const sp = { key: sort.key, dir: sort.dir }

  function arrow(key) {
    if (sort.key !== key) return <span className="sort-arrow">↕</span>
    return <span className="sort-arrow" style={{ opacity: 1, color: 'var(--accent)' }}>{sort.dir === 'asc' ? '↑' : '↓'}</span>
  }

  const stepCols = []
  for (let i = 1; i <= maxSteps; i++) {
    stepCols.push({ openKey: `m${i}_open_rate_pct`, ctrKey: `m${i}_step_ctr_pct`, label: `M${i}` })
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
          <div className="page-subtitle">How every funnel is performing side by side. Click a column to sort.</div>
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
        <StatCard label="First message opened" value={averages.m1_open_rate_pct ?? 'n/a'} unit="%" delta="weighted by volume" />
        <StatCard label="First message clicked" value={averages.m1_ctr_pct ?? 'n/a'} unit="%" delta="weighted by volume" />
        <StatCard label="Second message clicked" value={averages.m2_step_ctr_pct ?? 'n/a'} unit="%" delta="weighted by volume" />
        <StatCard label="Finish rate" value={averages.funnel_cr_pct ?? 'n/a'} unit="%" delta="all branches counted" />
        <StatCard label="People reached" value={totalVol.toLocaleString()} unit="" delta="people who entered" />
      </div>

      {filtered.some(f => f.chain_valid === false) && (
        <div style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.30)', borderRadius: 12, padding: '16px 20px', marginBottom: 24 }}>
          <div style={{ fontFamily: 'var(--display)', fontWeight: 600, color: 'var(--gold)', marginBottom: 10, fontSize: 14 }}>
            Some steps came back on the wrong branch
          </div>
          {filtered.filter(f => f.chain_valid === false).map(f => (
            <div key={f.id} style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, padding: '6px 0' }}>
              <strong>{f.name}</strong>
              {(f.chain_issues || []).map((iss, i) => (
                <div key={i} style={{ color: 'var(--muted)', fontSize: 12 }}>{iss.detail}</div>
              ))}
            </div>
          ))}
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10, lineHeight: 1.7 }}>
            These funnels are showing raw numbers and they are sitting out of every average and comparison until you fix them. Open the funnel, remove the step that came from the wrong branch, and the corrected figures come back.
          </div>
        </div>
      )}

      <PatternSummary funnels={filteredClean} versionFilter={versionFilter} />

      {best && bestM1 && (
        <div className="insight">
          <strong>{best.name}</strong> finishes strongest at <strong>{best.funnel_cr_pct}% CR</strong>.{' '}
          <strong>{bestM1.name}</strong> has the best first message, clicked by <strong>{bestM1.m1_ctr_pct}%</strong>
          {bestM1.m1_ctr_pct > (averages.m1_ctr_pct || 0)
            ? `. ${(bestM1.m1_ctr_pct - averages.m1_ctr_pct).toFixed(1)}pp above average.`
            : '.'}
          {' '}<span style={{ color: 'var(--muted)' }}>Go to Message Intelligence for a detailed wording breakdown.</span>
        </div>
      )}

      <div className="table-wrap">
        <div className="table-header">
          <div className="table-title">{versionFilter === 'all' ? 'All Funnels' : versionFilter}. {filtered.length} total</div>
          <button className="btn btn-ghost btn-sm" onClick={load}>Refresh</button>
        </div>
        <table>
          <thead>
            <tr>
              {/* Actions. far left */}
              <th style={{ width: 56 }}></th>
              <th style={{ width: 32 }}></th>
              <th className={'sortable' + (sort.key === 'name' ? ' sorted' : '')} onClick={() => toggleSort('name')}>Funnel {arrow('name')}</th>
              <th className={'sortable' + (sort.key === 'version' ? ' sorted' : '')} onClick={() => toggleSort('version')}>Type {arrow('version')}</th>
              {stepCols.map(col => (
                <>
                  <th key={col.openKey} className={'sortable' + (sort.key === col.openKey ? ' sorted' : '')} onClick={() => toggleSort(col.openKey)} title="Out of the people who received this message, how many opened it">{col.label} opened {arrow(col.openKey)}</th>
                  <th key={col.ctrKey} className={'sortable' + (sort.key === col.ctrKey ? ' sorted' : '')} onClick={() => toggleSort(col.ctrKey)} title="Out of the people who opened this message, how many tapped the button">{col.label} clicked {arrow(col.ctrKey)}</th>
                </>
              ))}
              <th className={'sortable' + (sort.key === 'funnel_cr_pct' ? ' sorted' : '')} onClick={() => toggleSort('funnel_cr_pct')} title="Out of everyone who entered the funnel, how many took the final action, counting every branch">Finish rate {arrow('funnel_cr_pct')}</th>
              <th className={'sortable' + (sort.key === 'effective_sent' ? ' sorted' : '')} onClick={() => toggleSort('effective_sent')} title="People who entered the current version of this funnel">People in {arrow('effective_sent')}</th>
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
              <td className="mono-cell">{num(Math.round(averages.effective_sent))}</td>
            </tr>

            {sorted.map((f, i) => (
              <tr key={f.id} onClick={() => editingId !== f.id && navigate(`/funnels/${f.id}`)}>
                {/* Actions. far left, icon-only */}
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

                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Bar val={f.funnel_cr_pct} low={15} high={40} />
                    {f.chain_valid === false && (
                      <span title="Steps from two different branches got mixed together. Showing raw numbers." style={{ fontFamily: 'var(--sans)', fontSize: 9, fontWeight: 600, color: 'var(--gold)', cursor: 'help' }}>check</span>
                    )}
                    {f.funnel_cr_pct != null && f.chain_valid !== false && !f.cr_is_weighted && (
                      <span title="Only the busiest path is counted here. Upload the screenshots again to capture every branch." style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--gold)', cursor: 'help' }}>one path</span>
                    )}
                  </div>
                </td>
                <td className="mono-cell" style={{ color: 'var(--muted)' }}>
                  {num(f.effective_sent)}
                  {f.was_updated && f.effective_sent !== f.total_sent && (
                    <span title={`${num(f.total_sent)} people entered in total, but only this many saw the current version`} style={{ fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--gold)', marginLeft: 4, cursor: 'help' }}>~</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

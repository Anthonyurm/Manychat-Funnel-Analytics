import { useState } from 'react'

export const pct = (v, d = 1) => v == null ? '—' : Number(v).toFixed(d) + '%'
export const num = v => v == null ? '—' : Number(v).toLocaleString()

export const VERSIONS = ['Song Out Now', 'Pre-Release / Early Access', 'New Follower Automation', 'Other']

export function colorFor(val, low = 20, high = 50) {
  if (val == null) return 'var(--muted)'
  if (val >= high) return 'var(--accent3)'
  if (val >= low) return 'var(--gold)'
  return 'var(--accent2)'
}

export function classFor(val, low = 20, high = 50) {
  if (val == null) return ''
  if (val >= high) return 'good'
  if (val >= low) return 'mid'
  return 'low'
}

export function Bar({ val, max = 100, low = 20, high = 50 }) {
  const w = val != null ? Math.min(100, (val / max) * 100) : 0
  return (
    <div className="bar-wrap">
      <div className="bar-track">
        <div className={'bar-fill ' + classFor(val, low, high)} style={{ width: w + '%' }} />
      </div>
      <div className="bar-label" style={{ color: colorFor(val, low, high) }}>{pct(val)}</div>
    </div>
  )
}

export function Badge({ version }) {
  const cls = {
    'Song Out Now': 'badge-outnow',
    'Pre-Release / Early Access': 'badge-presave',
    'New Follower Automation': 'badge-newfollow',
    'Other': 'badge-other',
  }
  return <span className={'badge ' + (cls[version] || 'badge-unknown')}>{version || 'Unknown'}</span>
}

export function Spinner() {
  return <div className="loading"><div className="spinner" /> Loading…</div>
}

export function StatCard({ label, value, unit, delta }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}<span className="stat-unit">{unit}</span></div>
      {delta && <div className="stat-delta">{delta}</div>}
    </div>
  )
}

export function ThWithTip({ label, tip, sortKey, sortState, onSort }) {
  const [show, setShow] = useState(false)
  const isSorted = sortState?.key === sortKey
  return (
    <th
      className={'sortable' + (isSorted ? ' sorted' : '')}
      onClick={() => onSort && onSort(sortKey)}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      style={{ position: 'relative' }}
    >
      <div className="th-wrap">
        {label}
        {sortState && <span className="sort-arrow">{isSorted ? (sortState.dir === 'asc' ? '↑' : '↓') : '↕'}</span>}
        {show && tip && <div className="tooltip">{tip}</div>}
      </div>
    </th>
  )
}

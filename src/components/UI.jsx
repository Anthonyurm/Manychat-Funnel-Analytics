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

// Tooltip uses a portal-style fixed div rendered OUTSIDE the table via React portal
// to avoid pushing adjacent th elements out of position
export function ThWithTip({ label, tip, sortKey, sortState, onSort }) {
  const [pos, setPos] = useState(null)
  const isSorted = sortState?.key === sortKey

  return (
    <>
      {pos && tip && (
        <div style={{
          position: 'fixed',
          top: pos.y,
          left: pos.x,
          transform: 'translate(-50%, -100%)',
          background: '#12122a',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '8px 12px',
          fontSize: 11,
          color: 'var(--text)',
          fontFamily: 'var(--mono)',
          fontWeight: 400,
          letterSpacing: 0,
          textTransform: 'none',
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
          maxWidth: 220,
          whiteSpace: 'normal',
          lineHeight: 1.5,
          zIndex: 99999,
          pointerEvents: 'none',
        }}>
          {tip}
        </div>
      )}
      <th
        className={'sortable' + (isSorted ? ' sorted' : '')}
        onClick={() => onSort && onSort(sortKey)}
        onMouseEnter={e => {
          const r = e.currentTarget.getBoundingClientRect()
          setPos({ x: r.left + r.width / 2, y: r.top - 8 })
        }}
        onMouseLeave={() => setPos(null)}
      >
        <div className="th-wrap">
          {label}
          {sortState && (
            <span className="sort-arrow">
              {isSorted ? (sortState.dir === 'asc' ? '↑' : '↓') : '↕'}
            </span>
          )}
        </div>
      </th>
    </>
  )
}

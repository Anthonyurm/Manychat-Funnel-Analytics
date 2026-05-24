import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Layout({ session }) {
  const navigate = useNavigate()

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  const email = session?.user?.email || ''
  const initials = email.slice(0, 2).toUpperCase()

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="logo">
          <div className="logo-mark">Funnel Analytics</div>
          <div className="logo-sub">Elite Artist Society</div>
        </div>

        <div className="nav-section">Analytics</div>
        <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
          <span className="nav-icon">⚡</span> Overview
        </NavLink>
        <NavLink to="/intel" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
          <span className="nav-icon">🧠</span> Message Intel
        </NavLink>

        <div className="nav-section">Funnels</div>
        <NavLink to="/funnels/new" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
          <span className="nav-icon">＋</span> Add Funnel
        </NavLink>

        <div style={{ flex: 1 }} />

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: 'rgba(124,92,252,0.2)', color: '#b0a0ff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700, flexShrink: 0
            }}>{initials}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>{email}</div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }} onClick={signOut}>
            Sign out
          </button>
        </div>
      </nav>

      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}

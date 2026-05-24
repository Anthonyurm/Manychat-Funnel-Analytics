import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Layout from './components/Layout'
import Login from './pages/Login'
import Overview from './pages/Overview'
import FunnelDetail from './pages/FunnelDetail'
import NewFunnel from './pages/NewFunnel'
import MessageIntel from './pages/MessageIntel'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (session === undefined) return (
    <div className="loading" style={{ height: '100vh' }}>
      <div className="spinner" /> Loading…
    </div>
  )

  if (!session) return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    </BrowserRouter>
  )

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout session={session} />}>
          <Route path="/" element={<Overview />} />
          <Route path="/intel" element={<MessageIntel />} />
          <Route path="/funnels/new" element={<NewFunnel />} />
          <Route path="/funnels/:id" element={<FunnelDetail />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

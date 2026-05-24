import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseCSV } from '../lib/csvParser'
import { importCSVRows, createFunnel, upsertStep, upsertMetric, uploadScreenshot, updateScreenshotResult } from '../lib/db'
import { Spinner } from '../components/UI'

const MODES = [
  { id: 'csv',      icon: '📄', label: 'Upload CSV',      sub: 'Import your Google Sheets export' },
  { id: 'manual',   icon: '✏️',  label: 'Build Manually',  sub: 'Enter funnel steps + metrics by hand' },
  { id: 'screenshot', icon: '🖼️', label: 'Screenshot',    sub: 'Upload a ManyChat flow image — AI parses it' },
]

// ── CSV MODE ─────────────────────────────────────────────────────────────────
function CSVMode({ onDone }) {
  const [status, setStatus] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleFile(file) {
    setLoading(true)
    setStatus('Parsing CSV…')
    try {
      const rows = await parseCSV(file)
      setStatus(`Found ${rows.length} funnels — importing…`)
      const res = await importCSVRows(rows)
      setResults(res)
      setStatus('Done!')
    } catch (e) {
      setStatus('Error: ' + e.message)
    }
    setLoading(false)
  }

  return (
    <div>
      <div className="upload-zone"
        onClick={() => document.getElementById('csv-input').click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over') }}
        onDragLeave={e => e.currentTarget.classList.remove('over')}
        onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('over'); handleFile(e.dataTransfer.files[0]) }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>📄</div>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Drop your CSV here</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
          Google Sheets export · same format as your existing tracking sheet
        </div>
        <input id="csv-input" type="file" accept=".csv" style={{ display: 'none' }}
          onChange={e => handleFile(e.target.files[0])} />
      </div>
      {loading && <div className="loading"><div className="spinner" /> {status}</div>}
      {results && (
        <div className="card">
          {results.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12 }}>
              <span style={{ color: r.status === 'ok' ? 'var(--accent3)' : 'var(--accent2)' }}>
                {r.status === 'ok' ? '✓' : '✗'}
              </span>
              <span>{r.name}</span>
              {r.error && <span style={{ color: 'var(--accent2)' }}>{r.error}</span>}
            </div>
          ))}
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onDone}>
            View Dashboard →
          </button>
        </div>
      )}
    </div>
  )
}

// ── MANUAL MODE ──────────────────────────────────────────────────────────────
function ManualMode({ onDone }) {
  const [step, setStep] = useState(1) // 1=funnel info, 2=steps
  const [funnel, setFunnel] = useState({ name: '', version: 'OUT NOW', keywords: '' })
  const [funnelId, setFunnelId] = useState(null)
  const [steps, setSteps] = useState([
    { label: 'M1', step_type: 'message', message_text: '', sent: '', opened: '', clicked: '' },
  ])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function saveFunnel(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const kws = funnel.keywords.split(',').map(k => k.trim()).filter(Boolean)
      const f = await createFunnel({ name: funnel.name, version: funnel.version, keywords: kws })
      setFunnelId(f.id)
      setStep(2)
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  async function saveSteps(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i]
        const created = await upsertStep({
          funnel_id: funnelId, step_order: i + 1,
          label: s.label, step_type: s.step_type, message_text: s.message_text || null,
        })
        if (s.sent || s.clicked) {
          await upsertMetric({
            step_id: created.id,
            sent: s.sent ? parseInt(s.sent) : null,
            opened: s.opened ? parseInt(s.opened) : null,
            clicked: s.clicked ? parseInt(s.clicked) : null,
          })
        }
      }
      onDone(funnelId)
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  function addStep() {
    setSteps(s => [...s, { label: `M${s.length + 1}`, step_type: 'message', message_text: '', sent: '', opened: '', clicked: '' }])
  }
  function removeStep(i) { setSteps(s => s.filter((_, idx) => idx !== i)) }
  function updateStep(i, field, val) { setSteps(s => s.map((st, idx) => idx === i ? { ...st, [field]: val } : st)) }

  if (step === 1) return (
    <form onSubmit={saveFunnel}>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Funnel Name *</label>
          <input className="form-input" placeholder="e.g. RUIN" value={funnel.name} onChange={e => setFunnel(f => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="form-group">
          <label className="form-label">Version</label>
          <select className="form-input" value={funnel.version} onChange={e => setFunnel(f => ({ ...f, version: e.target.value }))}>
            {['OUT NOW', 'PRE-SAVE', 'PRESAVE', 'UNKNOWN'].map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Keywords (comma-separated)</label>
        <input className="form-input" placeholder="e.g. RUIN, RUINMYLIFE" value={funnel.keywords} onChange={e => setFunnel(f => ({ ...f, keywords: e.target.value }))} />
      </div>
      {error && <div className="error-msg">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? <><span className="spinner" /> Saving…</> : 'Next — Add Steps →'}
      </button>
    </form>
  )

  return (
    <form onSubmit={saveSteps}>
      <div style={{ marginBottom: 20 }}>
        {steps.map((s, i) => (
          <div key={i} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ fontWeight: 700 }}>Step {i + 1}</div>
              {steps.length > 1 && <button type="button" className="btn btn-danger btn-sm" onClick={() => removeStep(i)}>Remove</button>}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Label</label>
                <input className="form-input" value={s.label} onChange={e => updateStep(i, 'label', e.target.value)} placeholder="M1" />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select className="form-input" value={s.step_type} onChange={e => updateStep(i, 'step_type', e.target.value)}>
                  {['message', 'condition', 'action', 'delay', 'goal'].map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            {s.step_type === 'message' && (
              <div className="form-group">
                <label className="form-label">Message Copy</label>
                <textarea className="form-input" value={s.message_text} onChange={e => updateStep(i, 'message_text', e.target.value)} placeholder="The DM text your subscribers receive…" />
              </div>
            )}
            <div className="form-row-3">
              {['sent', 'opened', 'clicked'].map(field => (
                <div key={field} className="form-group">
                  <label className="form-label">{field.charAt(0).toUpperCase() + field.slice(1)}</label>
                  <input className="form-input" type="number" min="0" value={s[field]} onChange={e => updateStep(i, field, e.target.value)} placeholder="0" />
                </div>
              ))}
            </div>
          </div>
        ))}
        <button type="button" className="btn btn-ghost" onClick={addStep}>＋ Add Step</button>
      </div>
      {error && <div className="error-msg">{error}</div>}
      <div style={{ display: 'flex', gap: 12 }}>
        <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? <><span className="spinner" /> Saving…</> : 'Save Funnel ✓'}
        </button>
      </div>
    </form>
  )
}

// ── SCREENSHOT MODE ───────────────────────────────────────────────────────────
function ScreenshotMode({ onDone }) {
  const [funnelName, setFunnelName] = useState('')
  const [funnelVersion, setFunnelVersion] = useState('OUT NOW')
  const [file, setFile] = useState(null)
  const [status, setStatus] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [funnelId, setFunnelId] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file || !funnelName) return
    setLoading(true)
    setStatus('Creating funnel…')
    try {
      const f = await createFunnel({ name: funnelName, version: funnelVersion })
      setFunnelId(f.id)
      setStatus('Uploading screenshot…')
      const { screenshotId, path } = await uploadScreenshot(f.id, file)
      setStatus('Analyzing with Claude Vision…')

      // Call Netlify function to parse with Claude
      const formData = new FormData()
      formData.append('screenshot_id', screenshotId)
      formData.append('funnel_id', f.id)
      formData.append('file', file)

      const resp = await fetch('/.netlify/functions/parse-screenshot', {
        method: 'POST', body: formData
      })
      const parsed = await resp.json()
      await updateScreenshotResult(screenshotId, { raw_json: parsed, parse_status: parsed.error ? 'failed' : 'success' })

      setResult(parsed)
      setStatus('Done!')
    } catch (err) {
      setStatus('Error: ' + err.message)
    }
    setLoading(false)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <div className="form-group">
          <label className="form-label">Funnel Name *</label>
          <input className="form-input" value={funnelName} onChange={e => setFunnelName(e.target.value)} placeholder="e.g. HONEYMOON" required />
        </div>
        <div className="form-group">
          <label className="form-label">Version</label>
          <select className="form-input" value={funnelVersion} onChange={e => setFunnelVersion(e.target.value)}>
            {['OUT NOW', 'PRE-SAVE', 'PRESAVE', 'UNKNOWN'].map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="upload-zone" style={{ marginBottom: 20 }}
        onClick={() => document.getElementById('ss-input').click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over') }}
        onDragLeave={e => e.currentTarget.classList.remove('over')}
        onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('over'); setFile(e.dataTransfer.files[0]) }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{file ? '✅' : '🖼️'}</div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>{file ? file.name : 'Drop ManyChat screenshot here'}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>PNG, JPG, WEBP</div>
        <input id="ss-input" type="file" accept="image/*" style={{ display: 'none' }} onChange={e => setFile(e.target.files[0])} />
      </div>

      {loading && <div className="loading"><div className="spinner" /> {status}</div>}

      {result && !loading && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ color: 'var(--accent3)', fontWeight: 700, marginBottom: 12 }}>
            ✓ Parsed {result.steps?.length || 0} steps, {result.connections?.length || 0} connections
          </div>
          {result.notes && <div style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>{result.notes}</div>}
          <button type="button" className="btn btn-primary" onClick={() => onDone(funnelId)}>View Funnel →</button>
        </div>
      )}

      {!loading && !result && (
        <button className="btn btn-primary" type="submit" disabled={!file || !funnelName}>
          ✦ Analyze Screenshot
        </button>
      )}
    </form>
  )
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function NewFunnel() {
  const [mode, setMode] = useState(null)
  const navigate = useNavigate()

  function onDone(funnelId) {
    if (funnelId) navigate(`/funnels/${funnelId}`)
    else navigate('/')
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Add Funnel ＋</div>
          <div className="page-subtitle">Choose how you want to add your funnel data</div>
        </div>
      </div>

      {!mode ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 800 }}>
          {MODES.map(m => (
            <button key={m.id} onClick={() => setMode(m.id)}
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14,
                padding: 28, textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{m.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{m.label}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{m.sub}</div>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ maxWidth: 700 }}>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 24 }} onClick={() => setMode(null)}>
            ← Choose different method
          </button>
          <div className="card">
            <div className="card-title">
              {MODES.find(m => m.id === mode)?.icon} {MODES.find(m => m.id === mode)?.label}
            </div>
            {mode === 'csv' && <CSVMode onDone={() => navigate('/')} />}
            {mode === 'manual' && <ManualMode onDone={onDone} />}
            {mode === 'screenshot' && <ScreenshotMode onDone={onDone} />}
          </div>
        </div>
      )}
    </div>
  )
}

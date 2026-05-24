import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseCSV } from '../lib/csvParser'
import { importCSVRows, createFunnel, upsertStep, upsertMetric, saveScreenshotSteps } from '../lib/db'
import { VERSIONS } from '../components/UI'

const MODES = [
  { id: 'csv', icon: '📄', label: 'Upload CSV', sub: 'Import your Google Sheets export' },
  { id: 'manual', icon: '✏️', label: 'Build Manually', sub: 'Visual node-based flow builder with metrics' },
  { id: 'screenshot', icon: '🖼️', label: 'Screenshot', sub: 'Upload a ManyChat flow image — AI parses nodes + metrics' },
]

// ── CSV MODE ──────────────────────────────────────────────────────────────────
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
    } catch (e) { setStatus('Error: ' + e.message) }
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
        <div className="upload-title">Drop your CSV here</div>
        <div className="upload-sub">Same format as your Google Sheets tracking file</div>
        <input id="csv-input" type="file" accept=".csv" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
      </div>
      {loading && <div className="loading"><div className="spinner" /> {status}</div>}
      {results && (
        <div className="card">
          {results.map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12 }}>
              <span style={{ color: r.status === 'ok' ? 'var(--accent3)' : 'var(--accent2)' }}>{r.status === 'ok' ? '✓' : '✗'}</span>
              <span style={{ color: 'var(--text)' }}>{r.name}</span>
              {r.error && <span style={{ color: 'var(--accent2)' }}>{r.error}</span>}
            </div>
          ))}
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onDone}>View Dashboard →</button>
        </div>
      )}
    </div>
  )
}

// ── NODE CANVAS ───────────────────────────────────────────────────────────────
const NODE_TYPES = ['message', 'condition', 'goal']

function NodeCanvas({ nodes, setNodes, edges, setEdges, selectedId, setSelectedId }) {
  const canvasRef = useRef(null)
  const dragging = useRef(null)
  const connecting = useRef(null)

  const getOffset = () => {
    const rect = canvasRef.current?.getBoundingClientRect()
    return rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 }
  }

  function onMouseDown(e, nodeId) {
    e.stopPropagation()
    setSelectedId(nodeId)
    const offset = getOffset()
    const node = nodes.find(n => n.id === nodeId)
    dragging.current = { nodeId, startX: e.clientX - offset.x - node.x, startY: e.clientY - offset.y - node.y }
  }

  function onMouseMove(e) {
    if (dragging.current) {
      const offset = getOffset()
      const { nodeId, startX, startY } = dragging.current
      const x = Math.max(0, e.clientX - offset.x - startX)
      const y = Math.max(0, e.clientY - offset.y - startY)
      setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, x, y } : n))
    }
  }

  function onMouseUp() { dragging.current = null; connecting.current = null }

  function startConnect(e, fromId, portType = 'out') {
    e.stopPropagation()
    connecting.current = { fromId, portType }
  }

  function endConnect(e, toId) {
    e.stopPropagation()
    if (connecting.current && connecting.current.fromId !== toId) {
      const { fromId, portType } = connecting.current
      setEdges(es => [...es.filter(e => !(e.from === fromId && e.portType === portType)), { from: fromId, to: toId, portType, label: portType === 'out-yes' ? 'yes' : portType === 'out-no' ? 'no' : 'next' }])
    }
    connecting.current = null
  }

  function removeEdge(from, to) {
    setEdges(es => es.filter(e => !(e.from === from && e.to === to)))
  }

  const edgePaths = edges.map((edge, i) => {
    const fromNode = nodes.find(n => n.id === edge.from)
    const toNode = nodes.find(n => n.id === edge.to)
    if (!fromNode || !toNode) return null
    const x1 = fromNode.x + 100
    const y1 = fromNode.y + 110
    const x2 = toNode.x + 100
    const y2 = toNode.y
    const color = edge.portType === 'out-yes' ? '#3dffa0' : edge.portType === 'out-no' ? '#fc5c7d' : '#2e2e45'
    const my = (y1 + y2) / 2
    return (
      <g key={i} onClick={() => removeEdge(edge.from, edge.to)} style={{ cursor: 'pointer' }}>
        <path d={`M ${x1} ${y1} C ${x1} ${my} ${x2} ${my} ${x2} ${y2}`} stroke={color} strokeWidth={2} fill="none" />
        <text x={(x1 + x2) / 2} y={my} fill={color} fontSize={10} textAnchor="middle" fontFamily="var(--mono)" style={{ pointerEvents: 'none' }}>{edge.label}</text>
      </g>
    )
  })

  return (
    <div ref={canvasRef} className="canvas-area"
      onMouseMove={onMouseMove} onMouseUp={onMouseUp}
      onClick={() => setSelectedId(null)}>
      <svg className="canvas-edge">{edgePaths}</svg>
      {nodes.map(node => {
        const borderColor = node.type === 'condition' ? 'rgba(61,255,160,0.5)' : node.type === 'goal' ? 'rgba(255,209,102,0.5)' : 'var(--border)'
        return (
          <div key={node.id}
            className={'node' + (selectedId === node.id ? ' selected' : '')}
            style={{ left: node.x, top: node.y, borderColor: selectedId === node.id ? 'var(--accent)' : borderColor }}
            onMouseDown={e => onMouseDown(e, node.id)}>
            <div className="node-label" style={{ color: node.type === 'condition' ? '#3dffa0' : node.type === 'goal' ? '#ffd166' : 'var(--muted)' }}>{node.type.toUpperCase()}</div>
            <div className="node-title">{node.label || `Node ${node.id}`}</div>
            {node.message_text && <div className="node-msg">{node.message_text.slice(0, 55)}{node.message_text.length > 55 ? '…' : ''}</div>}
            <div className="node-port in" onMouseUp={e => endConnect(e, node.id)} />
            {node.type === 'condition' ? (
              <>
                <div className="node-port out-yes" onMouseDown={e => startConnect(e, node.id, 'out-yes')} title="Yes path" />
                <div className="node-port out-no" onMouseDown={e => startConnect(e, node.id, 'out-no')} title="No path" />
              </>
            ) : (
              <div className="node-port out" onMouseDown={e => startConnect(e, node.id, 'out')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── MANUAL MODE ───────────────────────────────────────────────────────────────
function ManualMode({ onDone }) {
  const [step, setStep] = useState(1)
  const [funnel, setFunnel] = useState({ name: '', version: 'Song Out Now', keywords: '' })
  const [funnelId, setFunnelId] = useState(null)
  const [nodes, setNodes] = useState([
    { id: 1, type: 'message', label: 'M1', message_text: '', cta_text: '', x: 40, y: 60, sent: '', opened: '', clicked: '' }
  ])
  const [edges, setEdges] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const nextId = useRef(2)

  const selectedNode = nodes.find(n => n.id === selectedId)

  function addNode(type) {
    const id = nextId.current++
    const msgNodes = nodes.filter(n => n.type === 'message')
    const label = type === 'message' ? `M${msgNodes.length + 1}` : type === 'condition' ? 'Condition' : 'Goal'
    setNodes(ns => [...ns, { id, type, label, message_text: '', cta_text: '', x: 60 + (ns.length * 30), y: 80 + (ns.length * 15), sent: '', opened: '', clicked: '' }])
  }

  function updateNode(id, field, val) {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, [field]: val } : n))
  }

  function removeNode(id) {
    setNodes(ns => ns.filter(n => n.id !== id))
    setEdges(es => es.filter(e => e.from !== id && e.to !== id))
    setSelectedId(null)
  }

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
      const msgNodes = nodes.filter(n => n.type === 'message').sort((a, b) => a.x - b.x)
      for (let i = 0; i < msgNodes.length; i++) {
        const node = msgNodes[i]
        const created = await upsertStep({
          funnel_id: funnelId, step_order: i + 1,
          label: node.label || `M${i + 1}`, step_type: 'message',
          message_text: node.message_text || null, cta_text: node.cta_text || null,
        })
        if (node.sent || node.clicked) {
          await upsertMetric({
            step_id: created.id,
            sent: node.sent ? parseInt(node.sent) : null,
            opened: node.opened ? parseInt(node.opened) : null,
            clicked: node.clicked ? parseInt(node.clicked) : null,
          })
        }
      }
      const goalNode = nodes.find(n => n.type === 'goal')
      if (goalNode) {
        const created = await upsertStep({
          funnel_id: funnelId, step_order: msgNodes.length + 1,
          label: 'Goal', step_type: 'goal', message_text: null, cta_text: null,
        })
        if (goalNode.sent || goalNode.clicked) {
          await upsertMetric({
            step_id: created.id,
            sent: goalNode.sent ? parseInt(goalNode.sent) : null,
            clicked: goalNode.clicked ? parseInt(goalNode.clicked) : null,
          })
        }
      }
      onDone(funnelId)
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  if (step === 1) return (
    <form onSubmit={saveFunnel}>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Funnel Name *</label>
          <input className="form-input" placeholder="e.g. New Follower Automation, WORST Song Out Now" value={funnel.name} onChange={e => setFunnel(f => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="form-group">
          <label className="form-label">Funnel Type</label>
          <select className="form-input" value={funnel.version} onChange={e => setFunnel(f => ({ ...f, version: e.target.value }))}>
            {VERSIONS.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Trigger Words (comma-separated)</label>
        <input className="form-input" placeholder="e.g. WORST, SONG, MUSIC" value={funnel.keywords} onChange={e => setFunnel(f => ({ ...f, keywords: e.target.value }))} />
      </div>
      {error && <div className="error-msg">{error}</div>}
      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? <><span className="spinner" /> Saving…</> : 'Next — Build Flow →'}
      </button>
    </form>
  )

  return (
    <form onSubmit={saveSteps}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => addNode('message')}>＋ Message</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => addNode('condition')}>＋ Condition</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => addNode('goal')}>＋ Goal</button>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
          Drag nodes · Drag bottom dot to connect · Click edge to remove
        </span>
      </div>

      <NodeCanvas nodes={nodes} setNodes={setNodes} edges={edges} setEdges={setEdges} selectedId={selectedId} setSelectedId={setSelectedId} />

      {selectedNode && (
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Editing: {selectedNode.label}</div>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeNode(selectedNode.id)}>Remove</button>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Label</label>
              <input className="form-input" value={selectedNode.label} onChange={e => updateNode(selectedNode.id, 'label', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-input" value={selectedNode.type} onChange={e => updateNode(selectedNode.id, 'type', e.target.value)}>
                {NODE_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          {selectedNode.type === 'message' && (
            <>
              <div className="form-group">
                <label className="form-label">Message Copy</label>
                <textarea className="form-input" value={selectedNode.message_text} onChange={e => updateNode(selectedNode.id, 'message_text', e.target.value)} placeholder="The DM text subscribers receive…" />
              </div>
              <div className="form-group">
                <label className="form-label">CTA Button Text</label>
                <input className="form-input" value={selectedNode.cta_text} onChange={e => updateNode(selectedNode.id, 'cta_text', e.target.value)} placeholder="e.g. get the song, listen now, join discord" />
              </div>
              <div className="form-row-3">
                {['sent', 'opened', 'clicked'].map(field => (
                  <div key={field} className="form-group">
                    <label className="form-label">{field.charAt(0).toUpperCase() + field.slice(1)}</label>
                    <input className="form-input" type="number" min="0" value={selectedNode[field]} onChange={e => updateNode(selectedNode.id, field, e.target.value)} placeholder="0" />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {error && <div className="error-msg">{error}</div>}
      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
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
  const [funnelVersion, setFunnelVersion] = useState('Song Out Now')
  const [files, setFiles] = useState([])
  const [status, setStatus] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [funnelId, setFunnelId] = useState(null)

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (files.length === 0 || !funnelName) return
    setLoading(true)
    setStatus('Creating funnel…')
    try {
      const f = await createFunnel({ name: funnelName, version: funnelVersion })
      setFunnelId(f.id)

      let allSteps = []
      let stepOffset = 0

      for (let i = 0; i < files.length; i++) {
        setStatus(`Analyzing image ${i + 1} of ${files.length} with Claude Vision…`)
        const base64 = await fileToBase64(files[i])
        const imageType = files[i].type || 'image/png'

        const resp = await fetch('/.netlify/functions/parse-screenshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: base64, image_type: imageType })
        })

        const parsed = await resp.json()
        if (parsed.error && !parsed.steps?.length) {
          setStatus(`Warning on image ${i + 1}: ${parsed.error}`)
          continue
        }

        const offsetSteps = (parsed.steps || []).map(s => ({ ...s, order: s.order + stepOffset }))
        allSteps = [...allSteps, ...offsetSteps]
        stepOffset += (parsed.steps || []).length
      }

      // Deduplicate
      const seen = new Set()
      allSteps = allSteps.filter(s => { if (seen.has(s.order)) return false; seen.add(s.order); return true })

      setStatus('Saving to database…')
      await saveScreenshotSteps(f.id, allSteps)
      setResult({ steps: allSteps })
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
          <input className="form-input" value={funnelName} onChange={e => setFunnelName(e.target.value)} placeholder="e.g. WORST Song Out Now" required />
        </div>
        <div className="form-group">
          <label className="form-label">Funnel Type</label>
          <select className="form-input" value={funnelVersion} onChange={e => setFunnelVersion(e.target.value)}>
            {VERSIONS.map(v => <option key={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="upload-zone" style={{ marginBottom: 16 }}
        onClick={() => document.getElementById('ss-input').click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over') }}
        onDragLeave={e => e.currentTarget.classList.remove('over')}
        onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('over'); setFiles(Array.from(e.dataTransfer.files)) }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>{files.length > 0 ? '✅' : '🖼️'}</div>
        <div className="upload-title">{files.length > 0 ? `${files.length} image(s) selected` : 'Drop ManyChat screenshots here'}</div>
        <div className="upload-sub">PNG, JPG, WEBP · Upload multiple images if your flow is wide</div>
        <input id="ss-input" type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => setFiles(Array.from(e.target.files))} />
      </div>

      {files.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {files.map((f, i) => (
            <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', padding: '3px 0' }}>📄 {f.name}</div>
          ))}
        </div>
      )}

      {loading && <div className="loading"><div className="spinner" /> {status}</div>}

      {result && !loading && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(61,255,160,0.3)' }}>
          <div style={{ color: 'var(--accent3)', fontWeight: 700, marginBottom: 8 }}>
            ✓ Parsed {result.steps?.length || 0} message steps
          </div>
          {result.steps?.map((s, i) => (
            <div key={i} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 11 }}>
              <span style={{ color: 'var(--accent)' }}>{s.label}</span>
              <span style={{ color: 'var(--muted)', margin: '0 8px' }}>·</span>
              <span style={{ color: 'var(--text)' }}>sent: {s.sent || '?'}</span>
              <span style={{ color: 'var(--muted)', margin: '0 8px' }}>·</span>
              <span style={{ color: 'var(--accent3)' }}>CTR: {s.ctr_raw ? Math.round(s.ctr_raw * 100) + '%' : '?'}</span>
              {s.cta_text && <span style={{ color: 'var(--gold)', marginLeft: 8 }}>CTA: "{s.cta_text}"</span>}
            </div>
          ))}
          <button type="button" className="btn btn-primary" style={{ marginTop: 14 }} onClick={() => onDone(funnelId)}>View Funnel →</button>
        </div>
      )}

      {!loading && !result && (
        <button className="btn btn-primary" type="submit" disabled={files.length === 0 || !funnelName}>
          ✦ Analyze Screenshot{files.length > 1 ? 's' : ''}
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
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, textAlign: 'left', cursor: 'pointer', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--surface2)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>{m.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: 'var(--text)' }}>{m.label}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{m.sub}</div>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ maxWidth: 860 }}>
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 24 }} onClick={() => setMode(null)}>← Choose different method</button>
          <div className="card">
            <div className="card-title">{MODES.find(m => m.id === mode)?.icon} {MODES.find(m => m.id === mode)?.label}</div>
            {mode === 'csv' && <CSVMode onDone={() => navigate('/')} />}
            {mode === 'manual' && <ManualMode onDone={onDone} />}
            {mode === 'screenshot' && <ScreenshotMode onDone={onDone} />}
          </div>
        </div>
      )}
    </div>
  )
}

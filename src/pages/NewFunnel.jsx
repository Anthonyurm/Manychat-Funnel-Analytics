import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseCSV } from '../lib/csvParser'
import { importCSVRows, createFunnel, upsertStep, upsertMetric, saveScreenshotSteps } from '../lib/db'
import { VERSIONS } from '../components/UI'

const MODES = [
  { id: 'csv', icon: '📄', label: 'Upload CSV', sub: 'Import your Google Sheets export' },
  { id: 'manual', icon: '✏️', label: 'Build Manually', sub: 'Visual node builder with conditional branching' },
  { id: 'screenshot', icon: '🖼️', label: 'Screenshot', sub: 'Upload ManyChat flow images — AI parses nodes and metrics' },
]

// ── CSV MODE ──────────────────────────────────────────────────────────────────
function CSVMode({ onDone }) {
  const [stage, setStage] = useState('upload')
  const [parsedRows, setParsedRows] = useState([])
  const [issues, setIssues] = useState([])
  const [clarifications, setClarifications] = useState({})
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')

  function detectIssues(rows) {
    const found = []
    rows.forEach((row, i) => {
      if (!row.name || row.name === 'UNKNOWN') found.push({ row: i, field: 'name', msg: `Row ${i + 1}: funnel name is missing or unclear — got "${row.name}"` })
      if (row.m1_sent == null && row.m1_clicked == null) found.push({ row: i, field: 'm1_metrics', msg: `Row ${i + 1} (${row.name}): no M1 sent or clicked data found` })
      if (row.version === 'UNKNOWN') found.push({ row: i, field: 'version', msg: `Row ${i + 1} (${row.name}): funnel type could not be detected` })
    })
    return found
  }

  async function handleFile(file) {
    setLoading(true)
    setStatus('Parsing CSV…')
    try {
      const rows = await parseCSV(file)
      const found = detectIssues(rows)
      setParsedRows(rows)
      setIssues(found)
      setStage(found.length > 0 ? 'clarify' : 'preview')
    } catch (e) {
      setStatus('Error reading file: ' + e.message)
    }
    setLoading(false)
    setStatus('')
  }

  async function doImport(rows) {
    setLoading(true)
    setStage('importing')
    const res = await importCSVRows(rows)
    setResults(res)
    setStage('done')
    setLoading(false)
  }

  function applyClarifications() {
    const updated = parsedRows.map((row, i) => ({ ...row, ...(clarifications[i] || {}) }))
    setParsedRows(updated)
    setStage('preview')
  }

  if (stage === 'upload') return (
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
    </div>
  )

  if (stage === 'clarify') return (
    <div>
      <div style={{ background: 'rgba(255,209,102,0.08)', border: '1px solid rgba(255,209,102,0.3)', borderRadius: 10, padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: 6 }}>Some rows need clarification before importing</div>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
          {issues.length} issue{issues.length > 1 ? 's were' : ' was'} found. Review and correct below, then continue.
        </div>
      </div>
      {issues.map((issue, i) => (
        <div key={i} className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--gold)', marginBottom: 10 }}>{issue.msg}</div>
          {issue.field === 'name' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Correct funnel name</label>
              <input className="form-input" placeholder="e.g. WORST Song Out Now" value={clarifications[issue.row]?.name || parsedRows[issue.row]?.name || ''} onChange={e => setClarifications(c => ({ ...c, [issue.row]: { ...c[issue.row], name: e.target.value } }))} />
            </div>
          )}
          {issue.field === 'version' && (
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Select funnel type</label>
              <select className="form-input" value={clarifications[issue.row]?.version || ''} onChange={e => setClarifications(c => ({ ...c, [issue.row]: { ...c[issue.row], version: e.target.value } }))}>
                <option value="">Select type…</option>
                {VERSIONS.map(v => <option key={v}>{v}</option>)}
              </select>
            </div>
          )}
          {issue.field === 'm1_metrics' && (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>This row will be imported without M1 metrics. You can add them manually from the funnel detail page.</div>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn-ghost" onClick={() => setStage('upload')}>Start Over</button>
        <button className="btn btn-primary" onClick={applyClarifications}>Continue to Preview</button>
      </div>
    </div>
  )

  if (stage === 'preview') return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16, color: 'var(--text)' }}>
        Preview — {parsedRows.length} funnel{parsedRows.length > 1 ? 's' : ''} ready to import
      </div>
      <div className="table-wrap" style={{ marginBottom: 20 }}>
        <table>
          <thead><tr><th>Name</th><th>Type</th><th>M1 Sent</th><th>M1 CTR</th><th>M2 Sent</th><th>Funnel CR</th></tr></thead>
          <tbody>
            {parsedRows.map((row, i) => (
              <tr key={i} style={{ cursor: 'default' }}>
                <td className="name-cell">{row.name || <span style={{ color: 'var(--accent2)' }}>Missing</span>}</td>
                <td><span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{row.version || '—'}</span></td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.m1_sent?.toLocaleString() || '—'}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.m1_cr != null ? Math.round(row.m1_cr * 100) + '%' : '—'}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.m2_sent?.toLocaleString() || '—'}</td>
                <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.funnel_cr != null ? Math.round(row.funnel_cr * 100) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <button className="btn btn-ghost" onClick={() => setStage('upload')}>Start Over</button>
        <button className="btn btn-primary" onClick={() => doImport(parsedRows)}>Import All</button>
      </div>
    </div>
  )

  if (stage === 'importing') return <div className="loading"><div className="spinner" /> Importing…</div>

  if (stage === 'done') return (
    <div className="card">
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Import complete</div>
      {results?.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12 }}>
          <span style={{ color: r.status === 'ok' ? 'var(--accent3)' : 'var(--accent2)' }}>{r.status === 'ok' ? 'OK' : 'Error'}</span>
          <span style={{ color: 'var(--text)' }}>{r.name}</span>
          {r.error && <span style={{ color: 'var(--accent2)' }}>{r.error}</span>}
        </div>
      ))}
      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onDone}>View Dashboard</button>
    </div>
  )

  return null
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
    const off = getOffset()
    const node = nodes.find(n => n.id === nodeId)
    dragging.current = { nodeId, startX: e.clientX - off.x - node.x, startY: e.clientY - off.y - node.y }
  }

  function onMouseMove(e) {
    if (!dragging.current) return
    const off = getOffset()
    const { nodeId, startX, startY } = dragging.current
    setNodes(ns => ns.map(n => n.id === nodeId ? { ...n, x: Math.max(0, e.clientX - off.x - startX), y: Math.max(0, e.clientY - off.y - startY) } : n))
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

  const edgePaths = edges.map((edge, i) => {
    const fn = nodes.find(n => n.id === edge.from)
    const tn = nodes.find(n => n.id === edge.to)
    if (!fn || !tn) return null
    const x1 = fn.x + 100, y1 = fn.y + 110, x2 = tn.x + 100, y2 = tn.y
    const color = edge.portType === 'out-yes' ? '#3dffa0' : edge.portType === 'out-no' ? '#fc5c7d' : '#2e2e45'
    const my = (y1 + y2) / 2
    return (
      <g key={i} onClick={() => setEdges(es => es.filter(e => !(e.from === edge.from && e.to === edge.to)))} style={{ cursor: 'pointer' }}>
        <path d={`M ${x1} ${y1} C ${x1} ${my} ${x2} ${my} ${x2} ${y2}`} stroke={color} strokeWidth={2} fill="none" />
        <text x={(x1+x2)/2} y={my} fill={color} fontSize={10} textAnchor="middle" fontFamily="var(--mono)" style={{ pointerEvents: 'none' }}>{edge.label}</text>
      </g>
    )
  })

  return (
    <div ref={canvasRef} className="canvas-area" onMouseMove={onMouseMove} onMouseUp={onMouseUp} onClick={() => setSelectedId(null)}>
      <svg className="canvas-edge">{edgePaths}</svg>
      {nodes.map(node => {
        const bc = node.type === 'condition' ? 'rgba(61,255,160,0.5)' : node.type === 'goal' ? 'rgba(255,209,102,0.5)' : 'var(--border)'
        return (
          <div key={node.id} className={'node' + (selectedId === node.id ? ' selected' : '')}
            style={{ left: node.x, top: node.y, borderColor: selectedId === node.id ? 'var(--accent)' : bc }}
            onMouseDown={e => onMouseDown(e, node.id)}>
            <div className="node-label" style={{ color: node.type === 'condition' ? '#3dffa0' : node.type === 'goal' ? '#ffd166' : 'var(--muted)' }}>{node.type.toUpperCase()}</div>
            <div className="node-title">{node.label || `Node ${node.id}`}</div>
            {node.message_text && <div className="node-msg">{node.message_text.slice(0,55)}{node.message_text.length > 55 ? '…' : ''}</div>}
            <div className="node-port in" onMouseUp={e => endConnect(e, node.id)} />
            {node.type === 'condition' ? (
              <>
                <div className="node-port out-yes" onMouseDown={e => startConnect(e, node.id, 'out-yes')} title="Yes path" />
                <div className="node-port out-no" onMouseDown={e => startConnect(e, node.id, 'out-no')} title="No path" />
              </>
            ) : <div className="node-port out" onMouseDown={e => startConnect(e, node.id, 'out')} />}
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
  const [nodes, setNodes] = useState([{ id: 1, type: 'message', label: 'M1', message_text: '', cta_text: '', x: 40, y: 60, sent: '', opened: '', clicked: '' }])
  const [edges, setEdges] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const nextId = useRef(2)
  const selectedNode = nodes.find(n => n.id === selectedId)

  function addNode(type) {
    const id = nextId.current++
    const msgCount = nodes.filter(n => n.type === 'message').length
    const label = type === 'message' ? `M${msgCount + 1}` : type === 'condition' ? 'Condition' : 'Goal'
    setNodes(ns => [...ns, { id, type, label, message_text: '', cta_text: '', x: 60 + ns.length * 30, y: 80 + ns.length * 15, sent: '', opened: '', clicked: '' }])
  }

  function updateNode(id, field, val) { setNodes(ns => ns.map(n => n.id === id ? { ...n, [field]: val } : n)) }
  function removeNode(id) { setNodes(ns => ns.filter(n => n.id !== id)); setEdges(es => es.filter(e => e.from !== id && e.to !== id)); setSelectedId(null) }

  async function saveFunnel(e) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const kws = funnel.keywords.split(',').map(k => k.trim()).filter(Boolean)
      const f = await createFunnel({ name: funnel.name, version: funnel.version, keywords: kws })
      setFunnelId(f.id); setStep(2)
    } catch (e) { setError(e.message) }
    setSaving(false)
  }

  async function saveSteps(e) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const msgNodes = nodes.filter(n => n.type === 'message').sort((a, b) => a.x - b.x)
      for (let i = 0; i < msgNodes.length; i++) {
        const node = msgNodes[i]
        const created = await upsertStep({ funnel_id: funnelId, step_order: i + 1, label: node.label || `M${i+1}`, step_type: 'message', message_text: node.message_text || null, cta_text: node.cta_text || null })
        if (node.sent || node.clicked) {
          await upsertMetric({ step_id: created.id, sent: node.sent ? parseInt(node.sent) : null, opened: node.opened ? parseInt(node.opened) : null, clicked: node.clicked ? parseInt(node.clicked) : null })
        }
      }
      const goalNode = nodes.find(n => n.type === 'goal')
      if (goalNode) {
        const created = await upsertStep({ funnel_id: funnelId, step_order: msgNodes.length + 1, label: 'Goal', step_type: 'goal', message_text: null, cta_text: null })
        if (goalNode.sent || goalNode.clicked) {
          await upsertMetric({ step_id: created.id, sent: goalNode.sent ? parseInt(goalNode.sent) : null, clicked: goalNode.clicked ? parseInt(goalNode.clicked) : null })
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
          <label className="form-label">Funnel Name</label>
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
      <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? <><span className="spinner" /> Saving…</> : 'Next — Build Flow'}</button>
    </form>
  )

  return (
    <form onSubmit={saveSteps}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => addNode('message')}>+ Message</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => addNode('condition')}>+ Condition</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => addNode('goal')}>+ Goal</button>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>Drag nodes to position — drag bottom dot to connect — click an edge to remove</span>
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
                <textarea className="form-input" value={selectedNode.message_text} onChange={e => updateNode(selectedNode.id, 'message_text', e.target.value)} placeholder="The DM text subscribers receive" />
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
        <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? <><span className="spinner" /> Saving…</> : 'Save Funnel'}</button>
      </div>
    </form>
  )
}

// ── SCREENSHOT MODE ───────────────────────────────────────────────────────────
// Calls Anthropic API directly from the browser to avoid Netlify's 10s timeout.
// The VITE_ANTHROPIC_KEY env var is required — set it in Netlify environment variables.
const VISION_PROMPT = `You are analyzing ManyChat flow builder screenshots for a music artist's Instagram DM automation. Treat all images as one continuous flow reading left to right.

EXTRACTION RULES:
1. ONLY extract Instagram Send Message nodes. SKIP everything else: Condition, Action, Smart Delay, When/trigger, External Request, Waiting nodes.
2. At every conditional branch, follow the path with the HIGHER Sent count (majority path).
3. From each Send Message node extract: full message body text, CTA button text (or null), and raw numbers for Sent, Opened, Clicked.
4. SKIP any message where Sent is less than 20% of the previous message Sent count — these are check-in messages or minority paths.
5. Label messages M1, M2, M3 etc in order following the majority path left to right and top to bottom.
6. Compute ctr_raw = Clicked / Sent. Compute open_rate_raw = Opened / Sent. Convert percentages to decimals (56.7% becomes 0.567).

Return ONLY this exact JSON, no markdown, no explanation:
{
  "steps": [
    {
      "order": 1,
      "label": "M1",
      "type": "message",
      "message_text": "exact message copy from node",
      "cta_text": "button label or null",
      "sent": 637,
      "opened": 431,
      "clicked": 361,
      "ctr_raw": 0.567,
      "open_rate_raw": 0.678,
      "notes": ""
    }
  ],
  "connections": [{ "from_order": 1, "to_order": 2, "label": "clicked" }],
  "funnel_notes": "summary of flow and which branches were followed"
}`

function ScreenshotMode({ onDone }) {
  const [funnelName, setFunnelName] = useState('')
  const [funnelVersion, setFunnelVersion] = useState('Song Out Now')
  const [files, setFiles] = useState([])
  const [stage, setStage] = useState('upload')
  const [parsed, setParsed] = useState(null)
  const [flagged, setFlagged] = useState({})
  const [funnelId, setFunnelId] = useState(null)
  const [error, setError] = useState('')

  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result.split(',')[1])
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  async function handleParse(e) {
    e.preventDefault()
    if (files.length === 0 || !funnelName) return
    setStage('parsing')
    setError('')

    try {
      // Convert all images to base64
      const imageContents = await Promise.all(files.map(async f => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: f.type || 'image/png',
          data: await fileToBase64(f),
        }
      })))

      // Add instruction block after all images
      const content = [
        ...imageContents,
        { type: 'text', text: VISION_PROMPT }
      ]

      // Call Anthropic API directly from browser — no server timeout
      const apiKey = import.meta.env.VITE_ANTHROPIC_KEY
      if (!apiKey) {
        setError('VITE_ANTHROPIC_KEY is not set. Add it to your Netlify environment variables.')
        setStage('upload')
        return
      }

      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 3000,
          messages: [{ role: 'user', content }]
        })
      })

      if (!resp.ok) {
        const errText = await resp.text()
        setError('API error: ' + errText)
        setStage('upload')
        return
      }

      const data = await resp.json()
      const rawText = data.content?.[0]?.text || ''
      const cleaned = rawText.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()

      let result
      try {
        result = JSON.parse(cleaned)
      } catch (e) {
        setError('Could not parse AI response. Try uploading a clearer screenshot.')
        setStage('upload')
        return
      }

      if (!result.steps?.length) {
        setError('No message steps detected. Make sure the screenshot clearly shows ManyChat Send Message nodes.')
        setStage('upload')
        return
      }

      setParsed(result)
      setStage('confirm')
    } catch (err) {
      setError('Parse failed: ' + err.message)
      setStage('upload')
    }
  }

  async function handleSave() {
    setStage('saving')
    try {
      const f = await createFunnel({ name: funnelName, version: funnelVersion })
      setFunnelId(f.id)
      // Only save steps that were not flagged as wrong
      const stepsToSave = (parsed.steps || []).filter((_, i) => !flagged[i])
      await saveScreenshotSteps(f.id, stepsToSave)
      setStage('done')
    } catch (err) {
      setError('Save failed: ' + err.message)
      setStage('confirm')
    }
  }

  if (stage === 'upload') return (
    <form onSubmit={handleParse}>
      <div className="form-row" style={{ marginBottom: 16 }}>
        <div className="form-group">
          <label className="form-label">Funnel Name</label>
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
        <div style={{ fontSize: 32, marginBottom: 8 }}>{files.length > 0 ? '✓' : '🖼️'}</div>
        <div className="upload-title">{files.length > 0 ? `${files.length} image${files.length > 1 ? 's' : ''} selected` : 'Drop ManyChat screenshots here'}</div>
        <div className="upload-sub">PNG, JPG, WEBP — upload multiple images if your flow is wide</div>
        <input id="ss-input" type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => setFiles(Array.from(e.target.files))} />
      </div>
      {files.length > 0 && files.map((f, i) => (
        <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', padding: '2px 0' }}>{f.name}</div>
      ))}
      {error && <div className="error-msg" style={{ margin: '12px 0' }}>{error}</div>}
      <button className="btn btn-primary" type="submit" style={{ marginTop: 12 }} disabled={files.length === 0 || !funnelName}>
        Analyze Screenshot{files.length > 1 ? 's' : ''}
      </button>
    </form>
  )

  if (stage === 'parsing') return (
    <div className="loading"><div className="spinner" /> Analyzing with Claude Vision — this takes 15–25 seconds for complex flows…</div>
  )

  if (stage === 'confirm') return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6, color: 'var(--text)' }}>
        Review parsed steps — {parsed?.steps?.length || 0} message steps found
      </div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 20 }}>
        Check each step below. Flag anything that looks wrong — flagged steps will be excluded from the import. You can add corrected data manually afterwards.
      </div>
      {parsed?.funnel_notes && (
        <div style={{ background: 'rgba(124,92,252,0.07)', border: '1px solid rgba(124,92,252,0.2)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: 'var(--text)' }}>
          {parsed.funnel_notes}
        </div>
      )}
      {(parsed?.steps || []).map((step, i) => (
        <div key={i} className="card" style={{ marginBottom: 12, borderColor: flagged[i] ? 'rgba(252,92,125,0.4)' : 'var(--border)', opacity: flagged[i] ? 0.55 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>{step.label}</span>
              {step.cta_text && <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--gold)', marginLeft: 12 }}>CTA: "{step.cta_text}"</span>}
            </div>
            <button className={'btn btn-sm ' + (flagged[i] ? 'btn-ghost' : 'btn-danger')} onClick={() => setFlagged(f => ({ ...f, [i]: !f[i] }))}>
              {flagged[i] ? 'Unflag' : 'Flag as wrong'}
            </button>
          </div>
          {step.message_text && (
            <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--muted)', borderLeft: '2px solid var(--border)', paddingLeft: 10, marginBottom: 10, lineHeight: 1.5 }}>
              "{step.message_text}"
            </div>
          )}
          <div style={{ display: 'flex', gap: 20, fontFamily: 'var(--mono)', fontSize: 11 }}>
            <span>Sent: <strong style={{ color: 'var(--text)' }}>{step.sent?.toLocaleString() || '—'}</strong></span>
            <span>Opened: <strong style={{ color: 'var(--text)' }}>{step.opened?.toLocaleString() || '—'}</strong></span>
            <span>Clicked: <strong style={{ color: 'var(--text)' }}>{step.clicked?.toLocaleString() || '—'}</strong></span>
            <span>CTR: <strong style={{ color: 'var(--accent3)' }}>{step.ctr_raw != null ? Math.round(step.ctr_raw * 100) + '%' : '—'}</strong></span>
          </div>
          {step.notes && <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>{step.notes}</div>}
        </div>
      ))}
      {error && <div className="error-msg" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
        <button className="btn btn-ghost" onClick={() => { setStage('upload'); setParsed(null); setFlagged({}) }}>Re-upload</button>
        <button className="btn btn-primary" onClick={handleSave}>
          Save {Object.values(flagged).filter(Boolean).length > 0
            ? `(${(parsed?.steps?.length || 0) - Object.values(flagged).filter(Boolean).length} of ${parsed?.steps?.length} steps)`
            : 'All Steps'}
        </button>
      </div>
    </div>
  )

  if (stage === 'saving') return <div className="loading"><div className="spinner" /> Saving to database…</div>

  if (stage === 'done') return (
    <div className="card" style={{ borderColor: 'rgba(61,255,160,0.3)' }}>
      <div style={{ color: 'var(--accent3)', fontWeight: 700, marginBottom: 12 }}>Funnel saved successfully</div>
      <button className="btn btn-primary" onClick={() => onDone(funnelId)}>View Funnel</button>
    </div>
  )

  return null
}

// ── MAIN PAGE ─────────────────────────────────────────────────────────────────
export default function NewFunnel() {
  const [mode, setMode] = useState(null)
  const navigate = useNavigate()
  function onDone(funnelId) { if (funnelId) navigate(`/funnels/${funnelId}`); else navigate('/') }

  return (
    <div>
      <div className="page-header">
        <div><div className="page-title">Add Funnel</div><div className="page-subtitle">Choose how you want to add your funnel data</div></div>
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
          <button className="btn btn-ghost btn-sm" style={{ marginBottom: 24 }} onClick={() => setMode(null)}>Back</button>
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

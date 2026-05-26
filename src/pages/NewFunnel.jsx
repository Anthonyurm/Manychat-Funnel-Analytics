import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createFunnel, saveScreenshotSteps } from '../lib/db'
import { VERSIONS } from '../components/UI'

const VISION_PROMPT = `You are analyzing ManyChat flow builder screenshots for a music artist's Instagram DM automation. Treat all images as one continuous flow reading left to right.

EXTRACTION RULES:
1. ONLY extract Instagram Send Message nodes. SKIP everything else: Condition, Action, Smart Delay, When/trigger, External Request, Waiting nodes.
2. A single Send Message node can contain multiple message bubbles stacked vertically. Do NOT split these into separate steps. One node header ("Instagram / Send Message #X") = one step. Combine all message text from the same node into one message_text field separated by a line break.
3. SKIP any message node where Clicked is 0 and there is no actionable CTA button — these are automated delivery nodes (e.g. "here's your link", "song unlocked"). The next message after it becomes the next step.
4. SKIP any message where Sent is less than 20% of the previous message Sent count — these are minority path branches.
5. At every split point where a message has multiple CTA buttons, follow the path triggered by the button with the HIGHEST CTR percentage. Record ALL button labels and their CTR percentages in branch_metadata for weighted CR calculation.
6. Label messages M1, M2, M3 etc in order following the majority path left to right and top to bottom.
7. Compute ctr_raw = Clicked / Sent. Compute open_rate_raw = Opened / Sent. Convert percentages to decimals (56.7% becomes 0.567).

Return ONLY this exact JSON, no markdown, no explanation:
{
  "steps": [
    {
      "order": 1,
      "label": "M1",
      "type": "message",
      "message_text": "exact message copy from node",
      "cta_text": "majority path button label or null",
      "sent": 637,
      "opened": 431,
      "clicked": 361,
      "ctr_raw": 0.567,
      "open_rate_raw": 0.678,
      "notes": ""
    }
  ],
  "connections": [
    {
      "from_order": 1,
      "to_order": 2,
      "label": "majority button label",
      "branch_metadata": {
        "total_sent_at_split": 943,
        "branches": [
          { "label": "Yes i have!", "ctr": 0.31, "sent": 292 },
          { "label": "Not yet", "ctr": 0.20, "sent": 189 }
        ]
      }
    }
  ],
  "funnel_notes": "summary of flow and which branches were followed"
}`

export default function NewFunnel() {
  const navigate = useNavigate()
  const [funnelName, setFunnelName] = useState('')
  const [funnelVersion, setFunnelVersion] = useState('Song Out Now')
  const [files, setFiles] = useState([])
  const [stage, setStage] = useState('upload')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState('')

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
    setStage('parsing')
    setError('')
    setProgress('Analyzing screenshots with Claude Vision…')

    try {
      const imageContents = await Promise.all(files.map(async f => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: f.type || 'image/png',
          data: await fileToBase64(f),
        }
      })))

      const content = [...imageContents, { type: 'text', text: VISION_PROMPT }]

      const apiKey = import.meta.env.VITE_ANTHROPIC_KEY
      if (!apiKey) {
        setError('VITE_ANTHROPIC_KEY is not set in Netlify environment variables.')
        setStage('error')
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
          max_tokens: 4000,
          messages: [{ role: 'user', content }]
        })
      })

      if (!resp.ok) {
        setError('API error: ' + await resp.text())
        setStage('error')
        return
      }

      const data = await resp.json()
      const rawText = data.content?.[0]?.text || ''
      const cleaned = rawText.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()

      let result
      try {
        result = JSON.parse(cleaned)
      } catch {
        setError('Could not read the flow from the screenshot. Try uploading a clearer, higher quality image.')
        setStage('error')
        return
      }

      if (!result.steps?.length) {
        setError('No message steps detected. Make sure the screenshot shows ManyChat Send Message nodes clearly with metrics visible.')
        setStage('error')
        return
      }

      setProgress(`Found ${result.steps.length} steps — saving funnel…`)
      const funnel = await createFunnel({ name: funnelName, version: funnelVersion })
      await saveScreenshotSteps(funnel.id, result.steps, result.connections)
      navigate(`/funnels/${funnel.id}`)

    } catch (err) {
      setError('Something went wrong: ' + err.message)
      setStage('error')
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Add Funnel</div>
          <div className="page-subtitle">
            Upload screenshots of your ManyChat flow — AI reads each step, message copy, CTA, and metrics automatically
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 640 }}>
        {stage === 'upload' && (
          <form onSubmit={handleSubmit}>
            <div className="card">
              <div className="form-row" style={{ marginBottom: 20 }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Funnel Name</label>
                  <input
                    className="form-input"
                    value={funnelName}
                    onChange={e => setFunnelName(e.target.value)}
                    placeholder="e.g. WORST Song Out Now"
                    required
                  />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Funnel Type</label>
                  <select className="form-input" value={funnelVersion} onChange={e => setFunnelVersion(e.target.value)}>
                    {VERSIONS.map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
              </div>

              <div
                className="upload-zone"
                onClick={() => document.getElementById('ss-input').click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('over') }}
                onDragLeave={e => e.currentTarget.classList.remove('over')}
                onDrop={e => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('over')
                  setFiles(Array.from(e.dataTransfer.files))
                }}>
                <div style={{ fontSize: 36, marginBottom: 10 }}>
                  {files.length > 0 ? '✓' : '🖼️'}
                </div>
                <div className="upload-title">
                  {files.length > 0
                    ? `${files.length} image${files.length > 1 ? 's' : ''} selected`
                    : 'Drop your ManyChat screenshots here'}
                </div>
                <div className="upload-sub">
                  PNG, JPG, WEBP · High quality screenshots only · Upload multiple images if your flow spans more than one screen
                </div>
                <input
                  id="ss-input"
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => setFiles(Array.from(e.target.files))}
                />
              </div>

              {files.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {files.map((f, i) => (
                    <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', padding: '2px 0' }}>
                      {f.name}
                    </div>
                  ))}
                </div>
              )}

              {error && <div className="error-msg" style={{ marginTop: 14 }}>{error}</div>}

              <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
                <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>Cancel</button>
                <button className="btn btn-primary" type="submit" disabled={files.length === 0 || !funnelName}>
                  Analyze {files.length > 1 ? `${files.length} Screenshots` : 'Screenshot'}
                </button>
              </div>
            </div>

            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px', marginTop: 16 }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 12 }}>
                How to take a good screenshot
              </div>
              {[
                'Set your ManyChat flow builder zoom to 100% or higher so all text is sharp and fully readable.',
                'Make sure every node shows its Sent, Opened, Clicked numbers and any button labels before screenshotting.',
                'Do not crop out any nodes — if your flow is wider than one screen, take multiple overlapping screenshots and upload them all at once.',
                'Avoid screenshotting on a small monitor or with browser zoom set below 100% — low resolution makes text unreadable for the AI.',
                'If the AI misses a step or gets a number wrong, go into the funnel detail page and use the Edit raw metrics button to correct it.',
              ].map((tip, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: i < 4 ? '1px solid var(--border)' : 'none', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', fontWeight: 700, flexShrink: 0, fontSize: 11, marginTop: 2 }}>{i + 1}.</span>
                  <span>{tip}</span>
                </div>
              ))}
            </div>
          </form>
        )}

        {stage === 'parsing' && (
          <div className="card" style={{ textAlign: 'center', padding: 48 }}>
            <div style={{ marginBottom: 20 }}>
              <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto' }} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: 'var(--text)' }}>Analyzing your flow</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>{progress}</div>
          </div>
        )}

        {stage === 'error' && (
          <div className="card">
            <div style={{ color: 'var(--accent2)', fontWeight: 700, marginBottom: 12 }}>Could not analyze screenshot</div>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 20, lineHeight: 1.6 }}>{error}</div>
            <button className="btn btn-primary" onClick={() => { setStage('upload'); setError('') }}>Try Again</button>
          </div>
        )}
      </div>
    </div>
  )
}

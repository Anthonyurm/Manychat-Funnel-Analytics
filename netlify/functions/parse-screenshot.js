exports.config = {
  bodyParser: {
    sizeLimit: '20mb'
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.AI_SECRET_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'API key not set', steps: [], connections: [] })
    }
  }

  try {
    const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body
    const { images } = JSON.parse(body)

    if (!images || images.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No image data provided', steps: [], connections: [] })
      }
    }

    const content = []
    images.forEach((img) => {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: img.type || 'image/png', data: img.base64 }
      })
    })

    content.push({
      type: 'text',
      text: `You are analyzing ${images.length > 1 ? images.length + ' ManyChat flow builder screenshots that together show one complete funnel' : 'a ManyChat flow builder screenshot'}. Read all images as one continuous flow from left to right.

RULES FOR EXTRACTION:
1. Only extract MESSAGE nodes (Instagram Send Message nodes). Ignore completely: Condition nodes, Action nodes, Smart Delay nodes, trigger nodes, external request nodes, waiting nodes.
2. Follow the majority path at every branch - follow the path with the higher Sent count.
3. For each message node extract: full message body text, CTA button text if visible, and metrics (Sent, Opened, Clicked counts).
4. Ignore follow-up check-in messages with very low sent counts (less than 20% of previous step sent count).
5. Number messages M1, M2, M3 etc following majority flow path left to right and top to bottom.
6. Calculate ctr_raw as clicked divided by sent. Calculate open_rate_raw as opened divided by sent.
7. Convert percentages like 56.7% to decimals like 0.567.

Return ONLY valid JSON with no markdown fences:
{
  "steps": [
    {
      "order": 1,
      "label": "M1",
      "type": "message",
      "message_text": "full DM text",
      "cta_text": "button text or null",
      "sent": 637,
      "opened": 432,
      "clicked": 361,
      "ctr_raw": 0.567,
      "open_rate_raw": 0.678,
      "notes": "observation"
    }
  ],
  "connections": [{ "from_order": 1, "to_order": 2, "label": "clicked" }],
  "funnel_notes": "brief description"
}`
    })

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 3000, messages: [{ role: 'user', content }] })
    })

    if (!response.ok) {
      const errText = await response.text()
      return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Anthropic API error: ' + errText, steps: [], connections: [] }) }
    }

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''
    const cleaned = rawText.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()

    let parsed
    try { parsed = JSON.parse(cleaned) }
    catch (e) { return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Failed to parse AI response: ' + e.message, raw: rawText, steps: [], connections: [] }) } }

    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed) }
  } catch (err) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message, steps: [], connections: [] }) }
  }
}

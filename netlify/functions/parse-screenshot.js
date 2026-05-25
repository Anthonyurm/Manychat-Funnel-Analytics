exports.config = {
  bodyParser: { sizeLimit: '20mb' }
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
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString()
      : event.body

    const parsed = JSON.parse(body)
    const images = parsed.images || []

    if (images.length === 0) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No image data provided', steps: [], connections: [] })
      }
    }

    // Build content array — all images first, then one instruction block
    const content = images.map(img => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: img.type || 'image/png',
        data: img.base64,
      }
    }))

    content.push({
      type: 'text',
      text: `You are analyzing ${images.length > 1 ? images.length + ' ManyChat flow builder screenshots showing one complete funnel' : 'a ManyChat flow builder screenshot'}. Treat all images as one continuous flow reading left to right.

EXTRACTION RULES — follow exactly:
1. ONLY extract Instagram "Send Message" nodes. SKIP everything else: Condition, Action, Smart Delay, When/trigger, External Request, Waiting nodes.
2. At every conditional branch, follow the path with the HIGHER Sent count (majority path).
3. From each Send Message node extract: full message body text, CTA button text (or null), and raw numbers for Sent, Opened, Clicked.
4. SKIP any message node where Sent is less than 20% of the previous message node's Sent — these are check-in messages on minority paths.
5. Label messages M1, M2, M3 etc in the order they appear following the majority path.
6. Compute ctr_raw = Clicked / Sent. Compute open_rate_raw = Opened / Sent. Convert percentages to decimals (56.7% becomes 0.567).

Return ONLY this exact JSON structure, no markdown, no explanation:
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
  "connections": [
    { "from_order": 1, "to_order": 2, "label": "clicked" }
  ],
  "funnel_notes": "summary of flow and which branches were followed"
}`
    })

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 3000,
        messages: [{ role: 'user', content }]
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Anthropic API error: ' + errText, steps: [], connections: [] })
      }
    }

    const data = await response.json()
    const rawText = data.content?.[0]?.text || ''
    const cleaned = rawText.trim().replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim()

    let result
    try {
      result = JSON.parse(cleaned)
    } catch (e) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'Could not parse AI response: ' + e.message,
          raw: rawText.slice(0, 500),
          steps: [],
          connections: []
        })
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, steps: [], connections: [] })
    }
  }
}

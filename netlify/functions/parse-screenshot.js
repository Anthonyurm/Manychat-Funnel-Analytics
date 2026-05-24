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
    const { image_base64, image_type } = JSON.parse(body)

    if (!image_base64) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No image data provided', steps: [], connections: [] })
      }
    }

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
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: image_type || 'image/png',
                data: image_base64,
              }
            },
            {
              type: 'text',
              text: `You are analyzing a ManyChat flow builder screenshot for a music artist's Instagram DM automation.

RULES FOR EXTRACTION:
1. Only extract MESSAGE nodes (Instagram "Send Message" nodes). Ignore: Condition nodes, Action nodes, Smart Delay nodes, trigger nodes, external request nodes.
2. Follow the majority path at every branch — if a condition splits traffic, follow the path with more people (higher Sent count).
3. For each message node extract: the message body text, the CTA button text if visible, and the metrics (Sent, Opened, Clicked counts).
4. Ignore any follow-up check-in messages that have very low sent counts compared to the previous step (less than 20% of previous step sent count).
5. Number messages in order M1, M2, M3 etc following the majority flow path left to right and top to bottom.
6. Calculate CTR as clicked divided by sent. Calculate open_rate as opened divided by sent.
7. For percentage values shown in the screenshot like 56.4% convert to decimal 0.564.

Return ONLY valid JSON with no markdown fences, no explanation text, exactly this structure:
{
  "steps": [
    {
      "order": 1,
      "label": "M1",
      "type": "message",
      "message_text": "the full DM message text visible in the node",
      "cta_text": "the button CTA text if visible or null",
      "sent": 3389,
      "opened": 2427,
      "clicked": 1911,
      "ctr_raw": 0.564,
      "open_rate_raw": 0.716,
      "notes": "any relevant observation"
    }
  ],
  "connections": [
    { "from_order": 1, "to_order": 2, "label": "clicked" }
  ],
  "funnel_notes": "brief description of the overall funnel structure"
}`
            }
          ]
        }]
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

    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (e) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Failed to parse AI response: ' + e.message, raw: rawText, steps: [], connections: [] })
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message, steps: [], connections: [] }),
    }
  }
}

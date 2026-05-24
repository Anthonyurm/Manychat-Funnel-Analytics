// netlify/functions/parse-screenshot.js
const Anthropic = require('@anthropic-ai/sdk')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) }

  try {
    // Parse multipart - get base64 image data
    const body = event.body
    const isBase64 = event.isBase64Encoded
    const contentType = event.headers['content-type'] || ''

    // For simplicity, the frontend should send the image as base64 JSON
    const { image_base64, image_type } = JSON.parse(
      isBase64 ? Buffer.from(body, 'base64').toString() : body
    )

    const client = new Anthropic({ apiKey })

    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image_type || 'image/png', data: image_base64 }
          },
          {
            type: 'text',
            text: `Analyze this ManyChat flow builder screenshot. Return ONLY valid JSON, no other text:

{
  "steps": [
    { "order": 1, "label": "node label", "type": "message|condition|action|delay|goal", "message_text": "visible copy or null" }
  ],
  "connections": [
    { "from_order": 1, "to_order": 2, "label": "clicked|yes|no|timeout|null" }
  ],
  "notes": "any observations"
}

Rules: assign order left-to-right or top-to-bottom. For condition nodes create two connections (yes/no). If text unreadable use null.`
          }
        ]
      }]
    })

    const raw = response.content[0].text.trim()
    const cleaned = raw.replace(/^```json?\n?/, '').replace(/\n?```$/, '')
    const parsed = JSON.parse(cleaned)

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

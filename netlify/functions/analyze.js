// netlify/functions/analyze.js
// Proxies AI analysis requests to Anthropic — keeps API key server-side

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { prompt } = JSON.parse(event.body || '{}')
  if (!prompt) return { statusCode: 400, body: 'Missing prompt' }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set' }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await response.json()
    const text = data.content?.map(b => b.text || '').join('') || ''

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: text,
    }
  } catch (err) {
    return { statusCode: 500, body: 'Error: ' + err.message }
  }
}

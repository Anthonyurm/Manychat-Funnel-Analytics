const Anthropic = require('@anthropic-ai/sdk')

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' }
  }

  const { prompt } = JSON.parse(event.body || '{}')
  if (!prompt) return { statusCode: 400, body: 'Missing prompt' }

  const apiKey = process.env.AI_SECRET_KEY
  if (!apiKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY not set in Netlify environment variables' }

  try {
    const client = new Anthropic({ apiKey })

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    })

    const text = message.content.map(b => b.text || '').join('')

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain' },
      body: text,
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: 'Error: ' + err.message
    }
  }
}

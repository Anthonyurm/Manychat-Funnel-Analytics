import { supabase } from './supabase'

// ── FUNNELS ──────────────────────────────────────────────────────────────────
export async function getFunnels() {
  const { data, error } = await supabase
    .from('funnels')
    .select(`*, keywords(*), steps(*, step_metrics(*))`)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map(enrichFunnel)
}

export async function getFunnel(id) {
  const { data, error } = await supabase
    .from('funnels')
    .select(`*, keywords(*), steps(*, step_metrics(*)), connections(*)`)
    .eq('id', id)
    .single()
  if (error) throw error
  return enrichFunnel(data)
}

export async function createFunnel({ name, version = 'OUT NOW', notes = '', keywords = [] }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: funnel, error } = await supabase
    .from('funnels')
    .insert({ name, version, notes, user_id: user.id })
    .select()
    .single()
  if (error) throw error

  if (keywords.length) {
    await supabase.from('keywords').insert(
      keywords.map(k => ({ funnel_id: funnel.id, keyword: k, user_id: user.id }))
    )
  }
  return funnel
}

export async function deleteFunnel(id) {
  const { error } = await supabase.from('funnels').delete().eq('id', id)
  if (error) throw error
}

// ── STEPS ────────────────────────────────────────────────────────────────────
export async function upsertStep({ funnel_id, step_order, label, step_type, message_text }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('steps')
    .insert({ funnel_id, step_order, label, step_type, message_text, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateStep(id, fields) {
  const { data, error } = await supabase
    .from('steps')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteStep(id) {
  const { error } = await supabase.from('steps').delete().eq('id', id)
  if (error) throw error
}

// ── METRICS ──────────────────────────────────────────────────────────────────
export async function upsertMetric({ step_id, sent, opened, clicked, source = 'manual' }) {
  const { data: { user } } = await supabase.auth.getUser()
  const ctr = sent && clicked ? clicked / sent : null
  const open_rate = sent && opened ? opened / sent : null

  // Delete existing metric for this step first (one metric per step)
  await supabase.from('step_metrics').delete().eq('step_id', step_id)

  const { data, error } = await supabase
    .from('step_metrics')
    .insert({ step_id, sent, opened, clicked, ctr, open_rate, source, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data
}

// ── CSV IMPORT ───────────────────────────────────────────────────────────────
export async function importCSVRows(rows) {
  const { data: { user } } = await supabase.auth.getUser()
  const results = []

  for (const row of rows) {
    try {
      // Create funnel
      const { data: funnel, error: fErr } = await supabase
        .from('funnels')
        .insert({ name: row.name, version: row.version, user_id: user.id })
        .select().single()
      if (fErr) throw fErr

      // Keywords
      if (row.keywords?.length) {
        await supabase.from('keywords').insert(
          row.keywords.map(k => ({ funnel_id: funnel.id, keyword: k, user_id: user.id }))
        )
      }

      // Step 1
      const { data: step1 } = await supabase.from('steps')
        .insert({ funnel_id: funnel.id, step_order: 1, label: 'M1', step_type: 'message', message_text: row.m1_message, user_id: user.id })
        .select().single()

      if (step1 && (row.m1_sent || row.m1_clicked)) {
        const m1Sent = row.m1_sent || null
        const m1Opened = row.m1_opened || null
        const m1Clicked = row.m1_clicked || null
        await supabase.from('step_metrics').insert({
          step_id: step1.id, user_id: user.id,
          sent: m1Sent, opened: m1Opened, clicked: m1Clicked,
          ctr: m1Sent && m1Clicked ? m1Clicked / m1Sent : null,
          open_rate: m1Sent && m1Opened ? m1Opened / m1Sent : null,
          source: 'csv_import'
        })
      }

      // Step 2 (optional)
      let step2 = null
      if (row.m2_sent || row.m2_clicked) {
        const { data: s2 } = await supabase.from('steps')
          .insert({ funnel_id: funnel.id, step_order: 2, label: 'M2', step_type: 'message', user_id: user.id })
          .select().single()
        step2 = s2
        if (s2) {
          await supabase.from('step_metrics').insert({
            step_id: s2.id, user_id: user.id,
            sent: row.m2_sent || null, opened: row.m2_opened || null, clicked: row.m2_clicked || null,
            ctr: row.m2_sent && row.m2_clicked ? row.m2_clicked / row.m2_sent : null,
            open_rate: row.m2_sent && row.m2_opened ? row.m2_opened / row.m2_sent : null,
            source: 'csv_import'
          })
        }
      }

      // Goal step
      const goalOrder = step2 ? 3 : 2
      const { data: goalStep } = await supabase.from('steps')
        .insert({ funnel_id: funnel.id, step_order: goalOrder, label: 'Goal', step_type: 'goal', user_id: user.id })
        .select().single()

      if (goalStep && row.funnel_cr != null && row.m1_sent) {
        await supabase.from('step_metrics').insert({
          step_id: goalStep.id, user_id: user.id,
          sent: row.m1_sent, clicked: Math.round(row.funnel_cr * row.m1_sent),
          ctr: row.funnel_cr, source: 'csv_import'
        })
      }

      // Connections
      if (step1 && step2) {
        await supabase.from('connections').insert({ funnel_id: funnel.id, from_step_id: step1.id, to_step_id: step2.id, label: 'clicked', user_id: user.id })
      }
      if (goalStep) {
        const fromStep = step2 || step1
        if (fromStep) await supabase.from('connections').insert({ funnel_id: funnel.id, from_step_id: fromStep.id, to_step_id: goalStep.id, label: 'clicked', user_id: user.id })
      }

      results.push({ name: row.name, status: 'ok' })
    } catch (e) {
      results.push({ name: row.name, status: 'error', error: e.message })
    }
  }
  return results
}

// ── SCREENSHOT ───────────────────────────────────────────────────────────────
export async function uploadScreenshot(funnelId, file) {
  const { data: { user } } = await supabase.auth.getUser()
  const path = `${user.id}/${funnelId}/${Date.now()}_${file.name}`

  const { error: uploadErr } = await supabase.storage
    .from('screenshots')
    .upload(path, file)
  if (uploadErr) throw uploadErr

  const { data: ss } = await supabase.from('screenshots')
    .insert({ funnel_id: funnelId, user_id: user.id, file_path: path, parse_status: 'pending' })
    .select().single()

  return { screenshotId: ss.id, path }
}

export async function updateScreenshotResult(id, { raw_json, parse_status }) {
  await supabase.from('screenshots')
    .update({ raw_json: JSON.stringify(raw_json), parse_status, parsed_at: new Date().toISOString() })
    .eq('id', id)
}

// ── ANALYTICS ────────────────────────────────────────────────────────────────
export function computeOverview(funnels) {
  const rows = funnels.map(f => {
    const steps = f.steps || []
    const m1 = steps.find(s => s.step_order === 1)
    const m2 = steps.find(s => s.step_order === 2 && s.step_type === 'message')
    const goal = steps.find(s => s.step_type === 'goal')
    const m1m = m1?.step_metrics?.[0]
    const m2m = m2?.step_metrics?.[0]
    const gm = goal?.step_metrics?.[0]
    return {
      id: f.id, name: f.name, version: f.version,
      keywords: f.keywords?.map(k => k.keyword) || [],
      m1_message: m1?.message_text,
      total_sent: m1m?.sent,
      m1_open_rate_pct: m1m?.open_rate != null ? +(m1m.open_rate * 100).toFixed(1) : null,
      m1_ctr_pct: m1m?.ctr != null ? +(m1m.ctr * 100).toFixed(1) : null,
      m2_open_rate_pct: m2m?.open_rate != null ? +(m2m.open_rate * 100).toFixed(1) : null,
      m2_ctr_pct: m2m?.ctr != null ? +(m2m.ctr * 100).toFixed(1) : null,
      funnel_cr_pct: gm?.ctr != null ? +(gm.ctr * 100).toFixed(1) : null,
      step_count: steps.filter(s => s.step_type !== 'goal').length,
    }
  })

  const avg = key => {
    const vals = rows.map(r => r[key]).filter(v => v != null)
    return vals.length ? +(vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(1) : null
  }

  return {
    funnels: rows,
    averages: {
      m1_open_rate_pct: avg('m1_open_rate_pct'),
      m1_ctr_pct: avg('m1_ctr_pct'),
      m2_open_rate_pct: avg('m2_open_rate_pct'),
      m2_ctr_pct: avg('m2_ctr_pct'),
      funnel_cr_pct: avg('funnel_cr_pct'),
      total_sent: avg('total_sent'),
    }
  }
}

// ── HELPERS ──────────────────────────────────────────────────────────────────
function enrichFunnel(f) {
  if (!f) return f
  f.steps = (f.steps || []).sort((a, b) => a.step_order - b.step_order)
  return f
}

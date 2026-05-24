import { supabase } from './supabase'

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

export async function createFunnel({ name, version = 'Song Out Now', notes = '', keywords = [] }) {
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

export async function updateFunnel(id, fields) {
  const { data, error } = await supabase
    .from('funnels')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteFunnel(id) {
  const { error } = await supabase.from('funnels').delete().eq('id', id)
  if (error) throw error
}

export async function upsertStep({ funnel_id, step_order, label, step_type, message_text, cta_text }) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('steps')
    .insert({ funnel_id, step_order, label, step_type, message_text, cta_text, user_id: user.id })
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

export async function upsertMetric({ step_id, sent, opened, clicked, source = 'manual' }) {
  const { data: { user } } = await supabase.auth.getUser()
  const ctr = sent && clicked ? clicked / sent : null
  const open_rate = sent && opened ? opened / sent : null
  await supabase.from('step_metrics').delete().eq('step_id', step_id)
  const { data, error } = await supabase
    .from('step_metrics')
    .insert({ step_id, sent, opened, clicked, ctr, open_rate, source, user_id: user.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function importCSVRows(rows) {
  const { data: { user } } = await supabase.auth.getUser()
  const results = []
  for (const row of rows) {
    try {
      const { data: funnel, error: fErr } = await supabase
        .from('funnels')
        .insert({ name: row.name, version: row.version, user_id: user.id })
        .select().single()
      if (fErr) throw fErr

      if (row.keywords?.length) {
        await supabase.from('keywords').insert(
          row.keywords.map(k => ({ funnel_id: funnel.id, keyword: k, user_id: user.id }))
        )
      }

      const { data: step1 } = await supabase.from('steps')
        .insert({ funnel_id: funnel.id, step_order: 1, label: 'M1', step_type: 'message', message_text: row.m1_message, user_id: user.id })
        .select().single()

      if (step1 && (row.m1_sent || row.m1_clicked)) {
        const m1Sent = row.m1_sent || null
        await supabase.from('step_metrics').insert({
          step_id: step1.id, user_id: user.id,
          sent: m1Sent, opened: row.m1_opened || null, clicked: row.m1_clicked || null,
          ctr: m1Sent && row.m1_clicked ? row.m1_clicked / m1Sent : null,
          open_rate: m1Sent && row.m1_opened ? row.m1_opened / m1Sent : null,
          source: 'csv_import'
        })
      }

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

      const goalOrder = step2 ? 3 : 2
      const { data: goalStep } = await supabase.from('steps')
        .insert({ funnel_id: funnel.id, step_order: goalOrder, label: 'Goal', step_type: 'goal', user_id: user.id })
        .select().single()

      if (goalStep && row.funnel_cr != null && row.m1_sent) {
        await supabase.from('step_metrics').insert({
          step_id: goalStep.id, user_id: user.id,
          sent: row.m1_sent,
          clicked: Math.round(row.funnel_cr * row.m1_sent),
          ctr: row.funnel_cr, source: 'csv_import'
        })
      }

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

export async function uploadScreenshot(funnelId, file) {
  const { data: { user } } = await supabase.auth.getUser()
  const path = `${user.id}/${funnelId}/${Date.now()}_${file.name}`
  const { error: uploadErr } = await supabase.storage.from('screenshots').upload(path, file)
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

export async function saveScreenshotSteps(funnelId, parsedSteps) {
  const { data: { user } } = await supabase.auth.getUser()
  const { data: existingSteps } = await supabase.from('steps').select('id').eq('funnel_id', funnelId)
  if (existingSteps?.length) {
    for (const s of existingSteps) {
      await supabase.from('step_metrics').delete().eq('step_id', s.id)
    }
    await supabase.from('steps').delete().eq('funnel_id', funnelId)
  }
  for (const stepData of parsedSteps) {
    const { data: step } = await supabase.from('steps')
      .insert({
        funnel_id: funnelId,
        step_order: stepData.order,
        label: stepData.label,
        step_type: stepData.type || 'message',
        message_text: stepData.message_text || null,
        cta_text: stepData.cta_text || null,
        user_id: user.id,
      })
      .select().single()

    if (step && (stepData.sent || stepData.clicked)) {
      const sent = stepData.sent || null
      const opened = stepData.opened || null
      const clicked = stepData.clicked || null
      await supabase.from('step_metrics').insert({
        step_id: step.id, user_id: user.id,
        sent, opened, clicked,
        ctr: sent && clicked ? clicked / sent : null,
        open_rate: sent && opened ? opened / sent : null,
        source: 'screenshot',
      })
    }
  }
}

export function computeOverview(funnels) {
  const rows = funnels.map(f => {
    const steps = f.steps || []
    const msgSteps = steps.filter(s => s.step_type !== 'goal').sort((a, b) => a.step_order - b.step_order)
    const goalStep = steps.find(s => s.step_type === 'goal')
    const m1 = msgSteps[0]
    const m1m = m1?.step_metrics?.[0]
    const gm = goalStep?.step_metrics?.[0]

    const lastMsgWithSent = [...msgSteps].reverse().find(s => s.step_metrics?.[0]?.sent)
    const lastSent = lastMsgWithSent?.step_metrics?.[0]?.sent
    const m1Ctr = m1m?.ctr
    const effectiveSent = lastSent && m1Ctr && m1Ctr > 0
      ? Math.round(lastSent / m1Ctr)
      : m1m?.sent || null

    const goalClicks = gm?.clicked
    const funnelCr = goalClicks && effectiveSent ? goalClicks / effectiveSent : (gm?.ctr || null)

    const stepMetrics = {}
    msgSteps.forEach((s, i) => {
      const sm = s.step_metrics?.[0]
      const key = `m${i + 1}`
      stepMetrics[`${key}_open_rate_pct`] = sm?.open_rate != null ? +(sm.open_rate * 100).toFixed(1) : null
      stepMetrics[`${key}_ctr_pct`] = sm?.ctr != null ? +(sm.ctr * 100).toFixed(1) : null
      stepMetrics[`${key}_sent`] = sm?.sent || null
      stepMetrics[`${key}_message`] = s.message_text || null
      stepMetrics[`${key}_cta`] = s.cta_text || null
    })

    return {
      id: f.id,
      name: f.name,
      version: f.version,
      keywords: f.keywords?.map(k => k.keyw

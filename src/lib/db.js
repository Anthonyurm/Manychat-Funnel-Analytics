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
          sent: row.m1_sent, clicked: Math.round(row.funnel_cr * row.m1_sent),
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
    const msgSteps = steps
      .filter(s => s.step_type !== 'goal')
      .sort((a, b) => a.step_order - b.step_order)
    const goalStep = steps.find(s => s.step_type === 'goal')
    const m1 = msgSteps[0]
    const m1m = m1?.step_metrics?.[0]
    const gm = goalStep?.step_metrics?.[0]

    // Effective sent: if M2 sent < 70% of expected (M1 sent x M1 CTR),
    // the funnel was updated mid-run — reverse-engineer true cohort from M2 sent / M1 CTR
    let effectiveSent = m1m?.sent || null
    const m1Ctr = m1m?.ctr

    if (msgSteps.length >= 2 && m1m?.sent && m1Ctr) {
      const m2 = msgSteps[1]
      const m2m = m2?.step_metrics?.[0]
      if (m2m?.sent) {
        const expectedM2 = m1m.sent * m1Ctr
        const ratio = m2m.sent / expectedM2
        if (ratio < 0.7) {
          // Funnel was updated — reverse-engineer true cohort
          effectiveSent = Math.round(m2m.sent / m1Ctr)
        }
      }
    }

    // Build per-step metrics
    const stepMetrics = {}
    msgSteps.forEach((s, i) => {
      const sm = s.step_metrics?.[0]
      const key = `m${i + 1}`
      stepMetrics[`${key}_open_rate_pct`] = sm?.open_rate != null ? +(sm.open_rate * 100).toFixed(1) : null
      stepMetrics[`${key}_ctr_pct`] = sm?.ctr != null ? +(sm.ctr * 100).toFixed(1) : null
      stepMetrics[`${key}_sent`] = sm?.sent || null
      stepMetrics[`${key}_message`] = s.message_text || null
      stepMetrics[`${key}_cta`] = s.cta_text || null
      // Reach rate: what % of the true cohort made it to this step
      stepMetrics[`${key}_reach_pct`] = sm?.sent && effectiveSent
        ? +(sm.sent / effectiveSent * 100).toFixed(1) : null
    })

    // Funnel CR: goal clicks / effective sent, or last step clicks / effective sent
    const goalClicks = gm?.clicked
    let funnelCr = null
    if (goalClicks && effectiveSent) {
      funnelCr = goalClicks / effectiveSent
    } else if (gm?.ctr) {
      funnelCr = gm.ctr
    } else {
      const lastMsg = [...msgSteps].reverse().find(s => s.step_metrics?.[0]?.clicked)
      const lastClicks = lastMsg?.step_metrics?.[0]?.clicked
      if (lastClicks && effectiveSent) {
        funnelCr = lastClicks / effectiveSent
      }
    }

    return {
      id: f.id,
      name: f.name,
      version: f.version,
      keywords: f.keywords?.map(k => k.keyword) || [],
      total_sent: m1m?.sent || null,
      effective_sent: effectiveSent,
      funnel_cr_pct: funnelCr != null ? +(funnelCr * 100).toFixed(1) : null,
      step_count: msgSteps.length,
      max_step: msgSteps.length,
      ...stepMetrics,
    }
  })

  const maxSteps = Math.max(...rows.map(r => r.max_step || 1), 1)

  const avg = (key, versionFilter) => {
    const filtered = versionFilter ? rows.filter(r => r.version === versionFilter) : rows
    const vals = filtered.map(r => r[key]).filter(v => v != null)
    return vals.length ? +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null
  }

  const buildAverages = (versionFilter) => {
    const avgs = {}
    for (let i = 1; i <= maxSteps; i++) {
      avgs[`m${i}_open_rate_pct`] = avg(`m${i}_open_rate_pct`, versionFilter)
      avgs[`m${i}_ctr_pct`] = avg(`m${i}_ctr_pct`, versionFilter)
      avgs[`m${i}_reach_pct`] = avg(`m${i}_reach_pct`, versionFilter)
    }
    avgs.funnel_cr_pct = avg('funnel_cr_pct', versionFilter)
    avgs.total_sent = avg('total_sent', versionFilter)
    avgs.effective_sent = avg('effective_sent', versionFilter)
    return avgs
  }

  return {
    funnels: rows,
    averages: buildAverages(null),
    maxSteps,
    buildAverages,
    versions: [...new Set(rows.map(r => r.version).filter(Boolean))],
  }
}

function enrichFunnel(f) {
  if (!f) return f
  f.steps = (f.steps || []).sort((a, b) => a.step_order - b.step_order)
  return f
}

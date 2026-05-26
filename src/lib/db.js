import { supabase } from './supabase'

export async function getFunnels() {
  const { data, error } = await supabase
    .from('funnels')
    .select(`*, keywords(*), steps(*, step_metrics(*)), connections(*)`)
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
    .from('funnels').update(fields).eq('id', id).select().single()
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
    .select().single()
  if (error) throw error
  return data
}

export async function updateStep(id, fields) {
  const { data, error } = await supabase
    .from('steps').update(fields).eq('id', id).select().single()
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
    .select().single()
  if (error) throw error
  return data
}

export async function saveScreenshotSteps(funnelId, parsedSteps, parsedConnections) {
  const { data: { user } } = await supabase.auth.getUser()

  const { data: existingSteps } = await supabase.from('steps').select('id').eq('funnel_id', funnelId)
  if (existingSteps?.length) {
    for (const s of existingSteps) {
      await supabase.from('step_metrics').delete().eq('step_id', s.id)
    }
    await supabase.from('steps').delete().eq('funnel_id', funnelId)
  }
  await supabase.from('connections').delete().eq('funnel_id', funnelId)

  const stepIdMap = {}
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

    if (step) {
      stepIdMap[stepData.order] = step.id
      if (stepData.sent || stepData.clicked) {
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

  if (parsedConnections?.length) {
    for (const conn of parsedConnections) {
      const fromId = stepIdMap[conn.from_order]
      const toId = stepIdMap[conn.to_order]
      if (fromId && toId) {
        await supabase.from('connections').insert({
          funnel_id: funnelId,
          from_step_id: fromId,
          to_step_id: toId,
          label: conn.label || null,
          user_id: user.id,
          ...(conn.branch_metadata ? { branch_metadata: conn.branch_metadata } : {})
        })
      }
    }
  }
}

// ── NORMALISE STEPS ───────────────────────────────────────────────────────────
// For each consecutive step pair, check if the funnel was updated mid-run.
// Condition: next.sent < 70% of (curr.sent × curr_ctr_rate)
// where curr_ctr_rate is recalculated fresh from raw sent/clicked — NOT from
// the stored ctr field, which may differ due to rounding at parse time.
//
// If triggered: effectiveSent = next.sent / curr_ctr_rate (precise division)
// This matches: effectiveSent × curr_ctr_rate = next.sent exactly.
export function normaliseSteps(msgSteps) {
  if (!msgSteps.length) return []

  const raw = msgSteps.map(s => {
    const m = s.step_metrics?.[0]
    const sent = m?.sent || null
    const opened = m?.opened || null
    const clicked = m?.clicked || null
    // Recalculate CTR from raw counts for precision — do not use stored ctr field
    const ctrRate = sent && clicked ? clicked / sent : (m?.ctr || null)
    const openRate = sent && opened ? opened / sent : (m?.open_rate || null)

    return {
      step: s,
      sent,
      opened,
      clicked,
      ctrRate,   // precise rate from raw counts
      openRate,
      wasAdjusted: false,
      effectiveSent: sent,
      effectiveOpened: opened,
      effectiveClicked: clicked,
    }
  })

  for (let i = 0; i < raw.length - 1; i++) {
    const curr = raw[i]
    const next = raw[i + 1]

    // Need both curr's effective clicked and next's raw sent to compare
    if (!curr.effectiveClicked || !next.sent || !curr.ctrRate) continue

    // Expected next sent = curr effective clicked (people who clicked curr get next)
    const expectedNextSent = curr.effectiveClicked
    const ratio = next.sent / expectedNextSent

    // Only adjust if next.sent is significantly less than expected (< 70%)
    // This means the funnel was updated between these two steps
    if (ratio < 0.7) {
      // Precise calculation: effectiveSent = next.sent / ctrRate
      // This ensures: effectiveSent × ctrRate = next.sent exactly
      const newEffectiveSent = Math.round(next.sent / curr.ctrRate)
      const newEffectiveClicked = next.sent
      const newEffectiveOpened = curr.openRate
        ? Math.round(newEffectiveSent * curr.openRate)
        : null

      raw[i] = {
        ...curr,
        effectiveSent: newEffectiveSent,
        effectiveOpened: newEffectiveOpened,
        effectiveClicked: newEffectiveClicked,
        wasAdjusted: true,
      }
    }
    // If ratio >= 0.7, no adjustment — next.sent is within expected range
  }

  return raw
}

function computeWeightedCr(msgSteps, goalStep, connections, effectiveSent) {
  if (!effectiveSent) return null

  const hasBranchData = connections?.some(c => c.branch_metadata)

  if (!hasBranchData) {
    const gm = goalStep?.step_metrics?.[0]
    if (gm?.clicked) return gm.clicked / effectiveSent
    const lastMsg = [...msgSteps].reverse().find(s => s.step_metrics?.[0]?.clicked)
    const lastClicks = lastMsg?.step_metrics?.[0]?.clicked
    return lastClicks ? lastClicks / effectiveSent : null
  }

  let totalWeightedClicks = 0
  connections.forEach(conn => {
    if (!conn.branch_metadata) return
    try {
      const meta = typeof conn.branch_metadata === 'string'
        ? JSON.parse(conn.branch_metadata)
        : conn.branch_metadata
      if (meta.branches) {
        meta.branches.forEach(branch => {
          if (branch.sent && branch.end_clicks) {
            totalWeightedClicks += branch.end_clicks
          }
        })
      }
    } catch {}
  })

  if (totalWeightedClicks > 0) return totalWeightedClicks / effectiveSent

  const lastMsg = [...msgSteps].reverse().find(s => s.step_metrics?.[0]?.clicked)
  const lastClicks = lastMsg?.step_metrics?.[0]?.clicked
  return lastClicks ? lastClicks / effectiveSent : null
}

export function computeOverview(funnels) {
  const rows = funnels.map(f => {
    const steps = f.steps || []
    const msgSteps = steps
      .filter(s => s.step_type !== 'goal')
      .sort((a, b) => a.step_order - b.step_order)
    const goalStep = steps.find(s => s.step_type === 'goal')
    const connections = f.connections || []
    const m1raw = msgSteps[0]?.step_metrics?.[0]

    const normalised = normaliseSteps(msgSteps)
    const effectiveSent = normalised[0]?.effectiveSent || null
    const wasUpdated = normalised.some(n => n.wasAdjusted)
    const branchCount = connections.filter(c => c.branch_metadata).length

    const stepMetrics = {}
    normalised.forEach((n, i) => {
      const key = `m${i + 1}`

      stepMetrics[`${key}_open_rate_pct`] = n.effectiveOpened != null && n.effectiveSent
        ? +(n.effectiveOpened / n.effectiveSent * 100).toFixed(1)
        : (n.openRate != null ? +(n.openRate * 100).toFixed(1) : null)

      // Cumulative CTR: for adjusted M1, use ctrRate directly (it's precise)
      // For all others, use effectiveClicked / effectiveSent
      if (i === 0 && n.wasAdjusted && n.ctrRate != null) {
        stepMetrics[`${key}_ctr_pct`] = +(n.ctrRate * 100).toFixed(1)
      } else if (n.effectiveClicked != null && effectiveSent) {
        stepMetrics[`${key}_ctr_pct`] = +(n.effectiveClicked / effectiveSent * 100).toFixed(1)
      } else {
        stepMetrics[`${key}_ctr_pct`] = null
      }

      stepMetrics[`${key}_sent`] = n.effectiveSent
      stepMetrics[`${key}_message`] = n.step.message_text || null
      stepMetrics[`${key}_cta`] = n.step.cta_text || null
      stepMetrics[`${key}_was_adjusted`] = n.wasAdjusted
    })

    const weightedCr = computeWeightedCr(msgSteps, goalStep, connections, effectiveSent)

    return {
      id: f.id,
      name: f.name,
      version: f.version,
      keywords: f.keywords?.map(k => k.keyword) || [],
      total_sent: m1raw?.sent || null,
      effective_sent: effectiveSent,
      was_updated: wasUpdated,
      funnel_cr_pct: weightedCr != null ? +(weightedCr * 100).toFixed(1) : null,
      step_count: msgSteps.length,
      max_step: msgSteps.length,
      branch_count: branchCount,
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

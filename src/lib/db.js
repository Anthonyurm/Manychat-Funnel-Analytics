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

// FIX 8: use ?? so a genuine 0 is stored as 0, not silently converted to null
export async function upsertMetric({ step_id, sent, opened, clicked, source = 'manual' }) {
  const { data: { user } } = await supabase.auth.getUser()
  const s = sent ?? null
  const o = opened ?? null
  const c = clicked ?? null
  const ctr = s != null && c != null && s > 0 ? c / s : null
  const open_rate = s != null && o != null && s > 0 ? o / s : null
  await supabase.from('step_metrics').delete().eq('step_id', step_id)
  const { data, error } = await supabase
    .from('step_metrics')
    .insert({ step_id, sent: s, opened: o, clicked: c, ctr, open_rate, source, user_id: user.id })
    .select().single()
  if (error) throw error
  return data
}

export async function saveScreenshotSteps(funnelId, parsedSteps, parsedConnections, terminalOutcomes) {
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
      const sent = stepData.sent ?? null
      const opened = stepData.opened ?? null
      const clicked = stepData.clicked ?? null
      if (sent != null || clicked != null) {
        await supabase.from('step_metrics').insert({
          step_id: step.id, user_id: user.id,
          sent, opened, clicked,
          ctr: sent != null && clicked != null && sent > 0 ? clicked / sent : null,
          open_rate: sent != null && opened != null && sent > 0 ? opened / sent : null,
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

  // FIX 1: terminal outcomes power the weighted end to end CR
  if (terminalOutcomes?.length) {
    await supabase.from('funnels')
      .update({ terminal_outcomes: terminalOutcomes })
      .eq('id', funnelId)
  }
}

// ── NORMALISE STEPS ───────────────────────────────────────────────────────────
// FIX 2: iterate BACKWARD so a mid run update detected late in the funnel
// cascades all the way up the chain. Forward iteration only corrected the one
// step before the break and left every earlier step on the stale cohort.
//
// Detection: next step's effective sent is under 70% of this step's effective
// clicked. Correction: effectiveSent = next.effectiveSent / this step's own
// click rate, recomputed from raw counts for precision.
// Before touching anything, confirm the step list is actually a single path.
// Each step's audience must be a subset of the people who clicked the step
// before it. If a step was sent to materially more people than could possibly
// have arrived from its parent, the parser has crossed into a parallel branch
// and the list is a mixture of siblings rather than a sequence.
export function validateChain(rows) {
  const issues = []
  for (let i = 0; i < rows.length - 1; i++) {
    const curr = rows[i], next = rows[i + 1]
    if (curr.clicked == null || next.sent == null) continue
    if (curr.clicked === 0) continue
    // 1.5x tolerance absorbs rounding and small reporting lag
    if (next.sent > curr.clicked * 1.5) {
      issues.push({
        at: i + 2,
        detail: `M${i + 2} was sent to ${next.sent} people but only ${curr.clicked} clicked M${i + 1}. These are parallel branches, not consecutive steps.`
      })
    }
  }
  return { valid: issues.length === 0, issues }
}

// FIX 2: iterate BACKWARD so a mid run update detected late in the funnel
// cascades all the way up the chain. Forward iteration only corrected the one
// step before the break and left every earlier step on the stale cohort.
//
// Guarded: the cascade only runs on a validated path. On a mixed branch list
// it would shrink a real cohort to nothing, so raw figures are kept instead
// and the funnel is flagged for review.
export function normaliseSteps(msgSteps) {
  if (!msgSteps.length) return []

  const raw = msgSteps.map(s => {
    const m = s.step_metrics?.[0]
    const sent = m?.sent ?? null
    const opened = m?.opened ?? null
    const clicked = m?.clicked ?? null
    const ctrRate = sent != null && clicked != null && sent > 0 ? clicked / sent : (m?.ctr ?? null)
    const openRate = sent != null && opened != null && sent > 0 ? opened / sent : (m?.open_rate ?? null)
    return {
      step: s,
      sent, opened, clicked, ctrRate, openRate,
      wasAdjusted: false,
      chainValid: true,
      chainIssues: [],
      effectiveSent: sent,
      effectiveOpened: opened,
      effectiveClicked: clicked,
    }
  })

  const { valid, issues } = validateChain(raw)
  if (!valid) {
    return raw.map(r => ({ ...r, chainValid: false, chainIssues: issues }))
  }

  for (let i = raw.length - 2; i >= 0; i--) {
    const curr = raw[i]
    const next = raw[i + 1]

    if (curr.effectiveClicked == null || curr.effectiveClicked === 0) continue
    if (next.effectiveSent == null || !curr.ctrRate) continue

    const ratio = next.effectiveSent / curr.effectiveClicked
    if (ratio >= 0.7) continue

    const newEffectiveSent = Math.round(next.effectiveSent / curr.ctrRate)
    raw[i] = {
      ...curr,
      effectiveSent: newEffectiveSent,
      effectiveOpened: curr.openRate != null ? Math.round(newEffectiveSent * curr.openRate) : null,
      effectiveClicked: next.effectiveSent,
      wasAdjusted: true,
    }
  }

  // A correction that erases more than 95% of the entry cohort is far more
  // likely to be a misread flow than a genuine mid run edit. Keep the numbers
  // but mark them so nobody builds a decision on them unchecked.
  const rawEntry = raw[0]?.sent
  const effEntry = raw[0]?.effectiveSent
  if (rawEntry && effEntry && effEntry < rawEntry * 0.05) {
    const note = {
      at: 1,
      detail: `The entry step fell from ${rawEntry} to ${effEntry}, a drop of over 95%. Verify the parsed steps against the screenshot before trusting these figures.`
    }
    return raw.map(r => ({ ...r, chainValid: false, chainIssues: [note] }))
  }

  return raw
}

function computeWeightedCr(funnel, msgSteps, goalStep, effectiveSent) {
  if (!effectiveSent) return { cr: null, weighted: false }

  let outcomes = funnel.terminal_outcomes
  if (typeof outcomes === 'string') {
    try { outcomes = JSON.parse(outcomes) } catch { outcomes = null }
  }

  if (Array.isArray(outcomes) && outcomes.length) {
    const total = outcomes.reduce((s, o) => s + (Number(o?.clicked) || 0), 0)
    // One outcome means the flow is linear, which is complete data, not missing
    // data. What matters is whether the parser captured endpoints at all.
    if (total > 0) return { cr: total / effectiveSent, weighted: true }
  }

  // Majority fallback
  const gm = goalStep?.step_metrics?.[0]
  if (gm?.clicked) return { cr: gm.clicked / effectiveSent, weighted: false }
  const lastMsg = [...msgSteps].reverse().find(s => s.step_metrics?.[0]?.clicked)
  const lastClicks = lastMsg?.step_metrics?.[0]?.clicked
  return { cr: lastClicks ? lastClicks / effectiveSent : null, weighted: false }
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
    const effectiveSent = normalised[0]?.effectiveSent ?? null
    const m1Clicks = normalised[0]?.effectiveClicked ?? null
    const wasUpdated = normalised.some(n => n.wasAdjusted)
    const chainValid = normalised[0]?.chainValid !== false
    const chainIssues = normalised[0]?.chainIssues || []
    const branchCount = connections.filter(c => c.branch_metadata).length

    const stepMetrics = {}
    normalised.forEach((n, i) => {
      const key = `m${i + 1}`

      stepMetrics[`${key}_open_rate_pct`] = n.effectiveOpened != null && n.effectiveSent
        ? +(n.effectiveOpened / n.effectiveSent * 100).toFixed(1)
        : (n.openRate != null ? +(n.openRate * 100).toFixed(1) : null)

      // Cumulative: share of the original cohort still converting at this step.
      // Clamped at 100 because a step cannot convert more people than entered.
      // Exceeding it is proof the sequence is not a single path.
      stepMetrics[`${key}_ctr_pct`] = n.effectiveClicked != null && effectiveSent
        ? +(Math.min(100, n.effectiveClicked / effectiveSent * 100)).toFixed(1)
        : null

      // FIX 5: per step rate, so drop off analysis measures message strength
      // rather than the arithmetic decline baked into cumulative values
      stepMetrics[`${key}_step_ctr_pct`] = n.effectiveClicked != null && n.effectiveSent
        ? +(n.effectiveClicked / n.effectiveSent * 100).toFixed(1)
        : null

      stepMetrics[`${key}_sent`] = n.effectiveSent
      stepMetrics[`${key}_message`] = n.step.message_text || null
      stepMetrics[`${key}_cta`] = n.step.cta_text || null
      stepMetrics[`${key}_was_adjusted`] = n.wasAdjusted
    })

    const { cr: weightedCr, weighted } = computeWeightedCr(f, msgSteps, goalStep, effectiveSent)

    // FIX 4: downstream CR shares no denominator with M1 CTR, so correlating
    // the two is not spurious the way M1 CTR against funnel CR was
    const terminalClicks = weightedCr != null && effectiveSent ? weightedCr * effectiveSent : null
    const downstreamCrPct = terminalClicks != null && m1Clicks
      ? +(terminalClicks / m1Clicks * 100).toFixed(1)
      : null

    return {
      id: f.id,
      name: f.name,
      version: f.version,
      keywords: f.keywords?.map(k => k.keyword) || [],
      total_sent: m1raw?.sent ?? null,
      effective_sent: effectiveSent,
      was_updated: wasUpdated,
      chain_valid: chainValid,
      chain_issues: chainIssues,
      funnel_cr_pct: weightedCr != null ? +(Math.min(100, weightedCr * 100)).toFixed(1) : null,
      cr_is_weighted: weighted,
      downstream_cr_pct: downstreamCrPct,
      step_count: msgSteps.length,
      max_step: msgSteps.length,
      branch_count: branchCount,
      ...stepMetrics,
    }
  })

  const maxSteps = Math.max(...rows.map(r => r.max_step || 1), 1)

  // A funnel whose steps are not a single path produces numbers that are not
  // wrong so much as meaningless, and one of them will drag every average and
  // every comparison with it. Quarantine happens here rather than in each of
  // the four analysis surfaces, so nothing downstream can consume it.
  const clean = rows.filter(r => r.chain_valid !== false)
  const flagged = rows.filter(r => r.chain_valid === false)

  // FIX 3: volume weight by effective sent. An unweighted mean let a 4 send
  // node move the average as much as a 3,391 send node.
  const avg = (key, versionFilter, { weighted = true } = {}) => {
    const filtered = versionFilter ? clean.filter(r => r.version === versionFilter) : clean
    const usable = filtered.filter(r => r[key] != null)
    if (!usable.length) return null
    if (!weighted) {
      return +(usable.reduce((s, r) => s + r[key], 0) / usable.length).toFixed(1)
    }
    const totalW = usable.reduce((s, r) => s + (r.effective_sent || 0), 0)
    if (!totalW) {
      return +(usable.reduce((s, r) => s + r[key], 0) / usable.length).toFixed(1)
    }
    return +(usable.reduce((s, r) => s + r[key] * (r.effective_sent || 0), 0) / totalW).toFixed(1)
  }

  const buildAverages = (versionFilter) => {
    const avgs = {}
    for (let i = 1; i <= maxSteps; i++) {
      avgs[`m${i}_open_rate_pct`] = avg(`m${i}_open_rate_pct`, versionFilter)
      avgs[`m${i}_ctr_pct`] = avg(`m${i}_ctr_pct`, versionFilter)
      avgs[`m${i}_step_ctr_pct`] = avg(`m${i}_step_ctr_pct`, versionFilter)
    }
    avgs.funnel_cr_pct = avg('funnel_cr_pct', versionFilter)
    avgs.total_sent = avg('total_sent', versionFilter, { weighted: false })
    avgs.effective_sent = avg('effective_sent', versionFilter, { weighted: false })
    avgs.is_volume_weighted = true
    return avgs
  }

  return {
    funnels: rows,      // everything, so the table can still show flagged rows
    clean,              // the only set any analysis should read from
    flagged,
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

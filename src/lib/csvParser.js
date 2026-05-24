import Papa from 'papaparse'

function parseNum(v) {
  if (v == null || v === '' || v === '#DIV/0!') return null
  return parseInt(String(v).replace(/,/g, ''), 10) || null
}

function parsePct(v) {
  if (v == null || v === '' || v === '#DIV/0!') return null
  const s = String(v).replace('%', '').trim()
  const n = parseFloat(s)
  if (isNaN(n)) return null
  return n > 1 ? n / 100 : n
}

function parseFlowVersion(raw) {
  const parts = String(raw).trim().rsplit ? String(raw).trim().split(' - ') : String(raw).trim().split(' - ')
  if (parts.length >= 2) {
    const version = parts.pop()
    return { name: parts.join(' - '), version }
  }
  return { name: String(raw).trim(), version: 'UNKNOWN' }
}

export function parseCSV(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: false,
      skipEmptyLines: true,
      complete: ({ data }) => {
        try {
          // Row 0 = headers, Row 1 = descriptions, Rows 2+ = data
          const rows = data.slice(2).filter(r => r[0] && r[0].trim() && r[0] !== '#DIV/0!')

          const parsed = rows.map(r => {
            const { name, version } = parseFlowVersion(r[0])
            const kwRaw = String(r[1] || '').trim()
            const keywords = kwRaw
              ? kwRaw.split(/\s+or\s+/i).map(k => k.trim()).filter(Boolean)
              : []

            return {
              name, version, keywords,
              m1_message: r[2] ? String(r[2]).trim() : null,
              m1_sent:    parseNum(r[3]),
              m1_opened:  parseNum(r[4]),
              m1_clicked: parseNum(r[5]),
              m1_cr:      parsePct(r[6]),
              m2_sent:    parseNum(r[7]),
              m2_opened:  parseNum(r[8]),
              m2_clicked: parseNum(r[9]),
              funnel_cr:  parsePct(r[10]),
            }
          }).filter(r => r.name)

          resolve(parsed)
        } catch (e) {
          reject(e)
        }
      },
      error: reject
    })
  })
}

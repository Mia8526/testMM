import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Cache-Control', 'no-store, max-age=0')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

  try {
    const r = await fetch(
      'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://www.tpex.org.tw/',
        }
      }
    )
    clearTimeout(timeout)

    if (!r.ok) {
      console.error('TPEx upstream:', r.status)
      res.status(502).json({ error: `TPEx upstream failed (${r.status})` })
      return
    }

    const text = await r.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      console.error('TPEx JSON parse error')
      res.status(502).json({ error: 'TPEx JSON parse error' })
      return
    }

    const rows = Array.isArray(data) ? data : data?.data ?? []
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(502).json({ error: 'TPEx returned empty data' })
      return
    }

    res.status(200).json(rows)
  } catch (e: unknown) {
    clearTimeout(timeout)
    const msg = e instanceof Error ? e.message : String(e)
    console.error('TPEx proxy error:', msg)
    res.status(504).json({ error: msg })
  }
}

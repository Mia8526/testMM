import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  try {
    const r = await fetch('https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.tpex.org.tw/' }
    })
    if (!r.ok) { res.status(r.status).json({ error: 'upstream failed' }); return }
    const data = await r.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
}

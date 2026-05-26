import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  try {
    // TWSE 上市公司基本資料，含產業別
    const r = await fetch(
      'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://openapi.twse.com.tw/',
        }
      }
    )
    if (!r.ok) { res.status(r.status).json({ error: 'upstream failed' }); return }
    const data = await r.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
}

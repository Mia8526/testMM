import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://openapi.twse.com.tw/',
    }
    const urls = [
      'https://openapi.twse.com.tw/v1/opendata/t187ap03_L',
      'https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O',
    ]
    const results = await Promise.allSettled(
      urls.map(async (url) => {
        const r = await fetch(url, { headers })
        if (!r.ok) return []
        const data = await r.json()
        return Array.isArray(data) ? data : []
      })
    )
    const data = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : []
    )
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
}

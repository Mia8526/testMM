import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 允許跨域
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  const { date, stockNo } = req.query

  if (!date || !stockNo) {
    res.status(400).json({ error: 'Missing date or stockNo' })
    return
  }

  try {
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${date}&stockNo=${stockNo}`
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://www.twse.com.tw/',
      },
    })
    const data = await r.json()
    res.status(200).json(data)
  } catch (e) {
    res.status(500).json({ error: 'Fetch failed', detail: String(e) })
  }
}

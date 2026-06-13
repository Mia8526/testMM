import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  const { date, stockNo } = req.query
  if (!date || !stockNo) {
    res.status(400).json({ error: 'Missing date or stockNo' })
    return
  }

  // TWSE STOCK_DAY expects Gregorian YYYYMMDD.
  const twseDate = String(date)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${twseDate}&stockNo=${stockNo}`
    console.log('[twse-history] fetching:', url)

    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-TW,zh;q=0.9',
        'Referer': 'https://www.twse.com.tw/zh/trading/historical/stock-day.html',
        'X-Requested-With': 'XMLHttpRequest',
      },
    })
    clearTimeout(timeout)

    if (!r.ok) {
      console.error('[twse-history] upstream error:', r.status)
      res.status(200).json({ stat: 'error', data: [] })
      return
    }

    const text = await r.text()
    console.log('[twse-history] raw response:', text.slice(0, 200))

    let data
    try {
      data = JSON.parse(text)
    } catch {
      res.status(200).json({ stat: 'error', data: [] })
      return
    }

    res.status(200).json(data)
  } catch (e) {
    clearTimeout(timeout)
    console.error('[twse-history] exception:', e)
    res.status(200).json({ stat: 'error', data: [] })
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  try {
    const r = await fetch(
      'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Referer': 'https://www.tpex.org.tw/',
          'Origin': 'https://www.tpex.org.tw',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        }
      }
    )

    if (!r.ok) {
      console.error('TPEx upstream error:', r.status, await r.text())
      res.status(r.status).json({ error: `upstream ${r.status}` })
      return
    }

    const text = await r.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      console.error('TPEx parse error, raw:', text.slice(0, 200))
      res.status(200).setHeader('Content-Type', 'application/json').send('[]')
      return
    }

    res.status(200).json(data)
  } catch (e) {
    console.error('TPEx proxy exception:', e)
    res.status(500).json({ error: String(e) })
  }
}

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
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'zh-TW,zh;q=0.9',
          'Referer': 'https://www.tpex.org.tw/',
          'Origin': 'https://www.tpex.org.tw',
        }
      }
    )

    const text = await r.text()

    // 嘗試 parse JSON
    let data
    try {
      data = JSON.parse(text)
    } catch {
      // TPEx 有時回傳非標準 JSON，直接回傳原始文字讓前端處理
      res.status(200).setHeader('Content-Type', 'application/json').send(text)
      return
    }

    res.status(200).json(data)
  } catch (e) {
    console.error('TPEx proxy error:', e)
    res.status(500).json({ error: String(e) })
  }
}

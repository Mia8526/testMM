import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000) // 8 秒 timeout

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
      res.status(200).json([]) // 回傳空陣列而非 500，讓前端優雅降級
      return
    }

    const text = await r.text()
    let data
    try {
      data = JSON.parse(text)
    } catch {
      console.error('TPEx JSON parse error')
      res.status(200).json([])
      return
    }

    res.status(200).json(Array.isArray(data) ? data : data?.data ?? [])
  } catch (e: unknown) {
    clearTimeout(timeout)
    const msg = e instanceof Error ? e.message : String(e)
    console.error('TPEx proxy error:', msg)
    // 逾時或連線失敗時回傳空陣列，不要讓整頁壞掉
    res.status(200).json([])
  }
}

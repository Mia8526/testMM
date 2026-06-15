import type { VercelRequest, VercelResponse } from '@vercel/node'

type FlagType = 'attention' | 'disposition'

interface StockFlag {
  code: string
  name: string
  market: '上市' | '上櫃'
  type: FlagType
  reason?: string
  period?: string
}

async function fetchJson(url: string): Promise<Record<string, string>[]> {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/json',
      'Referer': url.includes('twse') ? 'https://openapi.twse.com.tw/' : 'https://www.tpex.org.tw/',
    },
  })
  if (!r.ok) return []
  const data = await r.json()
  return Array.isArray(data) ? data : data?.data ?? []
}

function normalizeCode(value?: string): string {
  return String(value ?? '').trim()
}

function isStockCode(code: string): boolean {
  return /^\d{4,5}$/.test(code) && !code.startsWith('0')
}

function pushFlag(
  flags: StockFlag[],
  row: Record<string, string>,
  market: '上市' | '上櫃',
  type: FlagType
) {
  const code = normalizeCode(row.Code ?? row.SecuritiesCompanyCode)
  if (!isStockCode(code)) return
  const name = String(row.Name ?? row.CompanyName ?? '').trim()
  flags.push({
    code,
    name,
    market,
    type,
    reason: String(
      row.TradingInfoForAttention ??
      row.TradingInformation ??
      row.ReasonsOfDisposition ??
      row.DispositionReasons ??
      ''
    ).trim(),
    period: String(row.DispositionPeriod ?? '').trim(),
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  try {
    const [
      twseAttention,
      twseDisposition,
      tpexAttention,
      tpexDisposition,
    ] = await Promise.all([
      fetchJson('https://openapi.twse.com.tw/v1/announcement/notice'),
      fetchJson('https://openapi.twse.com.tw/v1/announcement/punish'),
      fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_trading_warning_information'),
      fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_disposal_information'),
    ])

    const flags: StockFlag[] = []
    twseAttention.forEach((row) => pushFlag(flags, row, '上市', 'attention'))
    twseDisposition.forEach((row) => pushFlag(flags, row, '上市', 'disposition'))
    tpexAttention.forEach((row) => pushFlag(flags, row, '上櫃', 'attention'))
    tpexDisposition.forEach((row) => pushFlag(flags, row, '上櫃', 'disposition'))

    res.status(200).json(flags)
  } catch (e) {
    res.status(200).json([])
  }
}

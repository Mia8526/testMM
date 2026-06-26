import type { VercelRequest, VercelResponse } from '@vercel/node'

type TwseDailyRow = {
  Date: string
  Code: string
  Name: string
  TradeVolume: string
  TradeValue: string
  OpeningPrice: string
  HighestPrice: string
  LowestPrice: string
  ClosingPrice: string
  Change: string
  Transaction: string
}

function parseCsvLine(line: string): string[] {
  const values: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && inQuotes && next === '"') {
      current += '"'
      i += 1
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }
    current += char
  }
  values.push(current)
  return values
}

function normalizeTwseCsv(text: string): TwseDailyRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  return lines.slice(1).map((line) => {
    const [
      Date,
      Code,
      Name,
      TradeVolume,
      TradeValue,
      OpeningPrice,
      HighestPrice,
      LowestPrice,
      ClosingPrice,
      Change,
      Transaction,
    ] = parseCsvLine(line)

    return {
      Date,
      Code,
      Name,
      TradeVolume,
      TradeValue,
      OpeningPrice,
      HighestPrice,
      LowestPrice,
      ClosingPrice,
      Change,
      Transaction,
    }
  }).filter((row) => row.Date && row.Code)
}

async function fetchOpenApiRows(): Promise<TwseDailyRow[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  const r = await fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
    signal: controller.signal,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://openapi.twse.com.tw/' }
  })
  clearTimeout(timeout)
  if (!r.ok) throw new Error(`openapi failed (${r.status})`)
  const data = await r.json()
  return Array.isArray(data) ? data : []
}

async function fetchCsvRows(): Promise<TwseDailyRow[]> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  const r = await fetch('https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=json', {
    signal: controller.signal,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.twse.com.tw/' }
  })
  clearTimeout(timeout)
  if (!r.ok) throw new Error(`twse csv failed (${r.status})`)
  return normalizeTwseCsv(await r.text())
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  try {
    let rows: TwseDailyRow[] = []
    try {
      rows = await fetchCsvRows()
    } catch {
      rows = await fetchOpenApiRows()
    }

    if (rows.length === 0) {
      res.status(502).json({ error: 'TWSE upstream failed' })
      return
    }

    res.status(200).json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
}

import type { VercelRequest, VercelResponse } from '@vercel/node'
import yf from 'yahoo-finance2'
import { subDays, format } from 'date-fns'

function getYahooFinance() {
  let mod: any = yf
  if (mod.default) mod = mod.default
  if (typeof mod === 'function') return new mod()
  return mod
}

const yahooFinance = getYahooFinance()

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (req.method === 'OPTIONS') { res.status(200).end(); return }

  const symbol = String(req.query.symbol ?? '').trim().toUpperCase()
  if (!symbol) {
    res.status(400).json({ error: 'Missing symbol' })
    return
  }

  try {
    const endDate = new Date()
    const startDate = subDays(endDate, 90)
    const historical = await yahooFinance.historical(symbol, {
      period1: format(startDate, 'yyyy-MM-dd'),
      period2: format(endDate, 'yyyy-MM-dd'),
      interval: '1d' as const,
    })

    const rows = Array.isArray(historical)
      ? historical
          .filter((d: any) => d.close !== null && d.close !== undefined)
          .map((d: any) => ({
            date: d.date,
            close: d.close,
            volume: d.volume ?? 0,
          }))
      : []

    res.status(200).json({ stat: rows.length > 0 ? 'OK' : 'empty', data: rows })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    res.status(200).json({ stat: 'error', data: [], error: message })
  }
}

export type TaiwanMarket = 'TW' | 'TWO';

export interface TaiwanNameHit {
  code: string;
  market: TaiwanMarket;
  name: string;
  rank: number;
}

const CJK_RE = /[\u3400-\u9FFF]/;

export function hasCjk(text: string): boolean {
  return CJK_RE.test(text);
}

export function normalizeSearchName(raw: string): string {
  return String(raw || '')
    .normalize('NFC')
    .replace(/股份有限公司$/u, '')
    .replace(/有限公司$/u, '')
    .replace(/[\s,，.。、]+/g, '')
    .trim();
}

/** If the query already contains a Taiwan ticker, keep using the code. */
export function extractEmbeddedTaiwanCode(raw: string): string | null {
  const m = String(raw || '')
    .toUpperCase()
    .match(/(\d{4,6})(?:\.(TWO|TW))?/);
  if (!m) return null;
  return m[2] ? `${m[1]}.${m[2]}` : m[1];
}

function collect(
  map: Record<string, string>,
  market: TaiwanMarket,
): Array<{ code: string; market: TaiwanMarket; name: string }> {
  return Object.entries(map)
    .map(([code, name]) => ({
      code: String(code || '').trim(),
      market,
      name: normalizeSearchName(name),
    }))
    .filter((row) => row.code && row.name);
}

export function rankTaiwanNameMatches(
  query: string,
  listed: Record<string, string>,
  otc: Record<string, string>,
): TaiwanNameHit[] {
  const q = normalizeSearchName(query);
  if (!q || !hasCjk(q)) return [];

  const rows = [...collect(listed, 'TW'), ...collect(otc, 'TWO')];
  const scored: TaiwanNameHit[] = [];

  for (const row of rows) {
    let rank = 0;
    if (row.name === q) {
      rank = 400;
    } else if (row.name.startsWith(q)) {
      rank = 300 - Math.min(row.name.length, 80);
    } else if (q.length >= 2 && row.name.includes(q)) {
      rank = 180 - Math.min(row.name.length, 80);
    } else {
      continue;
    }
    if (row.market === 'TW') rank += 1;
    scored.push({ ...row, rank });
  }

  scored.sort((a, b) => b.rank - a.rank || a.code.localeCompare(b.code));
  return scored;
}

export function pickTaiwanNameMatch(
  query: string,
  listed: Record<string, string>,
  otc: Record<string, string>,
): TaiwanNameHit | null {
  return rankTaiwanNameMatches(query, listed, otc)[0] ?? null;
}

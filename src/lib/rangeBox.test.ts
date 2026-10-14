import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRangeBox, type OhlcBar } from './rangeBox.ts';

const bars = (base: number, upper: number, lower: number, breakdown: number): OhlcBar[] => {
  const out: OhlcBar[] = [];
  for (let i = 0; i < 32; i++) {
    const close = base + (i % 6 - 2.5) * (upper - lower) / 12;
    out.push({ date: `2026-05-${String(i + 1).padStart(2, '0')}`, high: i % 5 === 0 ? upper : close + 2, low: i % 5 === 2 ? lower : close - 2, close, volume: 1000 });
  }
  out.splice(20, 0, { date: '2026-05-00', high: upper * 2, low: lower / 2, close: lower / 2, volume: 0 });
  for (let i = 0; i < 3; i++) out.push({ date: `2026-06-0${i + 1}`, high: lower - 1, low: breakdown - 2, close: breakdown, volume: 2000 });
  return out;
};

test('8042 preserves recent structural box after confirmed breakdown and ignores zero-volume 99', () => {
  const result = detectRangeBox(bars(188, 200, 178, 165), 165);
  assert.equal(result.breakdown, true);
  assert.ok(result.lower! >= 176 && result.lower! <= 180, `lower=${result.lower}`);
  assert.notEqual(result.lower, 99);
});

test('2454 preserves prior lower near 4100', () => {
  const result = detectRangeBox(bars(4300, 4500, 4100, 3950), 3950);
  assert.equal(result.breakdown, true);
  assert.ok(result.lower! >= 4050 && result.lower! <= 4150, `lower=${result.lower}`);
});

test('zero-volume bars are excluded from lookback count', () => {
  const result = detectRangeBox(bars(188, 200, 178, 165), 165);
  assert.equal(result.lookbackDays, 35);
});

test('price below lower edge but not confirmed is marked as breakdown watch', () => {
  const result = detectRangeBox(bars(188, 200, 178, 176), 176);
  assert.equal(result.breakdown, false);
  assert.equal(result.status, '箱底失守觀察');
  assert.match(result.action, /尚未確認跌破/);
});

test('wide consolidation is labelled separately from a standard box', () => {
  const result = detectRangeBox(bars(330, 375, 280, 300), 300);
  assert.equal(result.isBoxRange, true);
  assert.equal(result.quality, 'wide');
  assert.match(result.status, /寬幅整理/);
});

test('isolated crash low is not used as current box floor (1717-style)', () => {
  const out: OhlcBar[] = [];
  // Older crash: single spike low ~53, then leave it
  for (let i = 0; i < 20; i++) {
    out.push({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, high: 62, low: 58, close: 60, volume: 1000 });
  }
  out[10] = { date: '2026-07-11', high: 55, low: 52.8, close: 53.5, volume: 5000 }; // isolated crash
  // Recent tighter consolidation ~69-79
  for (let i = 0; i < 30; i++) {
    const close = 74 + (i % 6 - 2.5) * 1.2;
    out.push({
      date: `2026-08-${String(i + 1).padStart(2, '0')}`,
      high: i % 4 === 0 ? 79 : close + 1.5,
      low: i % 4 === 2 ? 69.2 : close - 1.5,
      close,
      volume: 1200,
    });
  }
  const result = detectRangeBox(out, 75.8);
  assert.equal(result.isBoxRange, true);
  assert.ok(result.lower! >= 65, `lower should not be crash low, got ${result.lower}`);
  assert.ok(result.upper! <= 82, `upper=${result.upper}`);
  assert.equal(result.quality, 'standard');
});

test('2059 waterfall does not keep a live high-level box after the floor is gone', () => {
  // Actual 2059.TW daily OHLC 2026-07-17 → 2026-10-13 (Yahoo).
  const rows: Array<[string, number, number, number]> = [
    ['2026-07-17', 8575, 7835, 7890], ['2026-07-20', 8090, 7610, 7750], ['2026-07-21', 7975, 7380, 7975],
    ['2026-07-22', 8495, 8060, 8125], ['2026-07-23', 8350, 8005, 8200], ['2026-07-24', 8150, 7635, 7735],
    ['2026-07-27', 8275, 7675, 8275], ['2026-07-28', 7820, 7450, 7450], ['2026-07-29', 7595, 6840, 7145],
    ['2026-07-30', 7410, 6840, 7140], ['2026-07-31', 7850, 7760, 7850], ['2026-08-03', 8635, 8165, 8635],
    ['2026-08-04', 9495, 8720, 9495], ['2026-08-05', 9575, 9275, 9470], ['2026-08-06', 10100, 9510, 10100],
    ['2026-08-07', 11110, 11110, 11110], ['2026-08-10', 12220, 11590, 11905], ['2026-08-11', 12540, 11615, 12315],
    ['2026-08-12', 12295, 11790, 12045], ['2026-08-13', 12500, 11840, 12235], ['2026-08-14', 12670, 12010, 12500],
    ['2026-08-17', 13750, 13750, 13750], ['2026-08-18', 15085, 13965, 14370], ['2026-08-19', 14500, 13895, 14095],
    ['2026-08-20', 14495, 13795, 13925], ['2026-08-21', 14000, 13310, 13385], ['2026-08-24', 14720, 13650, 14410],
    ['2026-08-25', 14625, 14065, 14285], ['2026-08-26', 14590, 13855, 14510], ['2026-08-27', 14815, 14085, 14340],
    ['2026-08-28', 14595, 14005, 14300], ['2026-08-31', 14310, 13850, 14180], ['2026-09-01', 14740, 14005, 14150],
    ['2026-09-02', 14220, 13600, 13865], ['2026-09-03', 14195, 13255, 13450], ['2026-09-04', 14050, 13150, 13860],
    ['2026-09-07', 14145, 13700, 13905], ['2026-09-08', 14200, 12515, 12520], ['2026-09-09', 12785, 12285, 12400],
    ['2026-09-10', 12695, 12315, 12600], ['2026-09-11', 12300, 11950, 12080], ['2026-09-14', 12025, 11785, 11990],
    ['2026-09-15', 12075, 11665, 11715], ['2026-09-16', 12445, 11800, 12045], ['2026-09-17', 12730, 12215, 12295],
    ['2026-09-18', 12730, 12230, 12495], ['2026-09-21', 13050, 12510, 12800], ['2026-09-22', 13305, 12670, 12670],
    ['2026-09-23', 12725, 12320, 12390], ['2026-09-24', 12640, 12185, 12350], ['2026-09-29', 12550, 11900, 12115],
    ['2026-09-30', 12785, 12055, 12055], ['2026-10-01', 12270, 11760, 11835], ['2026-10-02', 12295, 11700, 12145],
    ['2026-10-05', 13355, 12450, 13355], ['2026-10-06', 13500, 12845, 13100], ['2026-10-07', 11790, 11790, 11790],
    ['2026-10-08', 10965, 10615, 10615], ['2026-10-12', 10625, 10120, 10580], ['2026-10-13', 10490, 10015, 10060],
  ];
  const data = rows.map(([date, high, low, close]) => ({ date, high, low, close, volume: 1000 }));
  const result = detectRangeBox(data, 10060);
  assert.equal(result.isBoxRange, false);
  assert.equal(result.breakdown, true);
  assert.equal(result.status, '非箱型：下降趨勢明顯');
  assert.equal(result.upper, null);
  assert.equal(result.lower, null);
  assert.match(result.action, /舊箱|止跌|新的/);
});

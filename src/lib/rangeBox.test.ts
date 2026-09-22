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

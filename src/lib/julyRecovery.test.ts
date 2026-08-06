import test from 'node:test';
import assert from 'node:assert/strict';
import { calcJulyRecovery, isJulyRecovery, recoveryScore } from './julyRecovery.ts';

function bar(date: string, open: number, high: number, low: number, close: number) {
  return { date, open, high, low, close, volume: 1000 };
}

function buildJune() {
  const june: ReturnType<typeof bar>[] = [];
  for (let d = 1; d <= 20; d += 1) {
    const day = String(d).padStart(2, '0');
    const close = 90 + d * 0.4;
    june.push(bar(`2026-06-${day}`, close - 1, close + 1, close - 2, close));
  }
  june.push(bar('2026-06-30', 98, 100, 97, 99));
  return june;
}

const julyPullback = [
  bar('2026-07-01', 98, 99, 95, 96),
  bar('2026-07-02', 96, 96.5, 90, 91),
  bar('2026-07-03', 91, 92, 88, 89),
  bar('2026-07-10', 89, 93, 88.5, 92),
  bar('2026-07-20', 92, 95, 91, 94),
];

test('recovered July open but not prior high', () => {
  const bars = [...buildJune(), ...julyPullback, bar('2026-08-05', 97, 99, 96.5, 98.2)];
  const m = calcJulyRecovery(bars, 98.2);
  assert.equal(m.priorHigh, 100);
  assert.equal(m.julyOpen, 98);
  assert.equal(m.julyLow, 88);
  assert.equal(m.recoveredJulyOpen, true);
  assert.equal(m.recoveredPriorHigh, false);
  assert.equal(m.recoveryKind, '收復7月開盤');
  assert.equal(isJulyRecovery(m), true);
});

test('recovered both prior high and July open', () => {
  const bars = [...buildJune(), ...julyPullback, bar('2026-08-05', 99, 101, 98.5, 100.5)];
  const m = calcJulyRecovery(bars, 100.5);
  assert.equal(m.recoveryKind, '雙收復');
  assert.equal(m.recoveredPriorHigh, true);
  assert.equal(m.recoveredJulyOpen, true);
});

test('no meaningful pullback does not qualify', () => {
  const flatJuly = [
    bar('2026-07-01', 99, 100, 98.5, 99.5),
    bar('2026-07-10', 99.5, 101, 99, 100.2),
    bar('2026-08-05', 100, 102, 99.5, 101),
  ];
  const m = calcJulyRecovery([...buildJune(), ...flatJuly], 101);
  assert.equal(m.recoveryKind, null);
  assert.equal(isJulyRecovery(m), false);
});

test('still in drawdown does not qualify', () => {
  const bars = [...buildJune(), ...julyPullback, bar('2026-08-05', 90, 92, 89, 91)];
  const m = calcJulyRecovery(bars, 91);
  assert.equal(m.recoveryKind, null);
  assert.ok((m.vsJulyOpenPct ?? 0) < 0);
});

test('parses ROC dates', () => {
  const bars = [
    bar('115/06/30', 98, 100, 97, 99),
    bar('115/07/01', 98, 99, 90, 91),
    bar('115/07/15', 91, 92, 88, 90),
    bar('115/08/05', 97, 99, 96, 98.5),
  ];
  const m = calcJulyRecovery(bars, 98.5, { year: 2026 });
  assert.equal(m.priorHigh, 100);
  assert.equal(m.julyOpen, 98);
  assert.equal(m.recoveryKind, '收復7月開盤');
});

test('score prefers dual recovery near the level', () => {
  const dual = recoveryScore({
    chg: 6,
    recoveryKind: '雙收復',
    vsPriorHighPct: 1,
    vsJulyOpenPct: 3,
    vol5: 120,
  });
  const openOnly = recoveryScore({
    chg: 6,
    recoveryKind: '收復7月開盤',
    vsPriorHighPct: -2,
    vsJulyOpenPct: 1,
    vol5: 120,
  });
  assert.ok(dual > openOnly);
});

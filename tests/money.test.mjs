// 測試「實際出貨的程式碼」：從 index.html 抽出 <script id="money-math"> 區塊實跑，
// 不是複製一份邏輯來測。執行：node tests/money.test.mjs
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const m = html.match(/<script id="money-math">([\s\S]*?)<\/script>/);
if (!m) { console.error('FAIL: index.html 找不到 money-math script 區塊'); process.exit(1); }

const moduleObj = { exports: {} };
vm.runInNewContext(m[1], { module: moduleObj, console });
const { decParse, decAdd, decSub, decMul, decDiv, decToFixed, decFormat, decFormatQty, DEC_HUNDRED, DEC_ZERO, computePositions, summarizeCurrencies, toTwdUnits, aggregateRealized, projectRetirement } = moduleObj.exports;

let passed = 0, failed = 0;
function eq(actual, expected, label) {
  if (String(actual) === String(expected)) { passed++; }
  else { failed++; console.error(`FAIL: ${label}\n  expected: ${expected}\n  actual:   ${actual}`); }
}

// --- 浮點尾差迴歸測試（教訓正本：123.456789012345 不得出現尾差）---
const longDec = decParse('123.456789012345');
eq(decToFixed(longDec, 8), '123.45678901', '長小數以 8 位定點四捨五入，無二進位浮點尾差');
eq(decToFixed(longDec, 2), '123.46', '長小數顯示 2 位');
eq(decToFixed(decAdd(decParse('0.1'), decParse('0.2')), 2), '0.30', '0.1+0.2 精確等於 0.30');
eq(decToFixed(decAdd(decParse('0.1'), decParse('0.2')), 8), '0.30000000', '0.1+0.2 全精度無尾差');
eq(decToFixed(decMul(decParse('105.8'), decParse('100')), 2), '10580.00', '105.8×100 台股市值');

// --- 加權平均成本（mockup VOO 情境：10@545 + 5@510 + 5@480）---
const cost = decAdd(decAdd(decMul(decParse('545'), decParse('10')), decMul(decParse('510'), decParse('5'))), decMul(decParse('480'), decParse('5')));
const qty = decParse('20');
eq(decToFixed(cost, 2), '10400.00', '總成本 10400');
eq(decToFixed(decDiv(cost, qty), 2), '520.00', '加權平均成本 520.00');
const mv = decMul(decParse('620'), qty);
const pl = decSub(mv, cost);
eq(decToFixed(pl, 2), '2000.00', '未實現損益 +2000');
eq(decToFixed(decMul(decDiv(pl, cost), DEC_HUNDRED), 2), '19.23', '報酬率 19.23%（與 mockup 一致）');

// --- 負數與四捨五入 ---
eq(decToFixed(decParse('-1234.5678'), 2), '-1234.57', '負數四捨五入');
eq(decToFixed(decParse('2.675'), 2), '2.68', '2.675 → 2.68（浮點下 toFixed 會錯給 2.67）');
eq(decToFixed(decParse('-2.675'), 2), '-2.68', '負數 half away from zero');
eq(decToFixed(decDiv(decParse('1'), decParse('3')), 8), '0.33333333', '1/3 定點');
eq(decToFixed(decDiv(decParse('2'), decParse('3')), 8), '0.66666667', '2/3 四捨五入');

// --- 格式化 ---
eq(decFormat(decParse('1250000'), 2), '1,250,000.00', '千分位');
eq(decFormat(decParse('-98765.4'), 2), '-98,765.40', '負數千分位');
eq(decFormat(decParse('999.999'), 2), '1,000.00', '進位跨千分位');
eq(decFormatQty(decParse('100')), '100', '整數股數不帶小數');
eq(decFormatQty(decParse('2.5000')), '2.5', '小數股數去尾零');
eq(decFormatQty(decParse('0.3333')), '0.3333', '碎股 4 位');

// --- 非法輸入防呆 ---
eq(decParse('abc'), null, '非數字 → null');
eq(decParse('1,000'), null, '含千分位輸入 → null（要求純數字字串）');
eq(decParse(''), null, '空字串 → null');
eq(decParse('1.2.3'), null, '雙小數點 → null');
eq(decParse(undefined), null, 'undefined → null');
eq(decDiv(decParse('1'), DEC_ZERO), null, '除以零 → null');

// --- 配置佔比（同幣別內權重 = 成本/幣別總成本 × 100）---
const wInvested = decParse('510'); // VOO 300 + 其他 210
const wCost = decParse('300');
const weight = decMul(decDiv(wCost, wInvested), DEC_HUNDRED);
eq(decToFixed(weight, 2), '58.82', '權重 300/510 = 58.82%');
eq(decToFixed(decMul(decDiv(decParse('510'), decParse('510')), DEC_HUNDRED), 2), '100.00', '單一持倉權重 100%');
// 集中度門檻 60%（定點 60×1e8）
eq(weight >= decParse('60'), false, '58.82% 未達 60% 門檻');
eq(decMul(decDiv(decParse('400'), decParse('510')), DEC_HUNDRED) >= decParse('60'), true, '78.4% 達 60% 門檻');

// --- 手續費小計（價×量 + 手續費，交易列表用）---
eq(decToFixed(decAdd(decMul(decParse('100'), decParse('3')), decParse('10')), 2), '310.00', 'VOO 3股@100+手續費10 = 310');
eq(decToFixed(decAdd(decMul(decParse('105'), decParse('2')), decParse('200')), 2), '410.00', '0050 2股@105+手續費200 = 410');

// --- 極大值 ---
eq(decFormat(decParse('999999999999.99'), 2), '999,999,999,999.99', '極大金額不失真');

// ==================== 投資組合引擎（買入/賣出/已實現） ====================
let seq = 0;
function tx(o) {
  return Object.assign({
    id: `id-${++seq}`, symbol: 'VOO', currency: 'USD', market: 'US', name: 'VOO',
    type: 'buy', tradeDate: 20260101, createdAt: seq, price: '100', quantity: '1', fee: '0', tax: '0'
  }, o);
}
function pos1(txs, priceMap) { return computePositions(txs, priceMap).positions[0]; }

// A. 單次買入 + 未實現（成本含買入手續費）
{
  const p = pos1([tx({ quantity: '10', price: '100', fee: '5' })], { VOO: { price: '120', updatedAt: 1, stale: false } });
  eq(decToFixed(p.qty, 0), '10', 'A 持有 10 股');
  eq(decToFixed(p.avgCost, 2), '100.50', 'A 均價含手續費 (1000+5)/10=100.50');
  eq(decToFixed(p.cost, 2), '1005.00', 'A 成本含買入手續費');
  eq(decToFixed(p.buyFees, 2), '5.00', 'A 買入手續費另記錄供透明呈現');
  eq(decToFixed(p.marketValue, 2), '1200.00', 'A 市值 1200');
  eq(decToFixed(p.unrealized, 2), '195.00', 'A 未實現 1200-1005=195');
  eq(decToFixed(p.unrealizedPct, 2), '19.40', 'A 報酬率 195/1005=19.40%');
  eq(decToFixed(p.realized, 2), '0.00', 'A 無賣出，已實現 0');
}

// B. 多次買入加權平均
{
  const p = pos1([tx({ quantity: '10', price: '100' }), tx({ quantity: '10', price: '200', tradeDate: 20260102 })], {});
  eq(decToFixed(p.avgCost, 2), '150.00', 'B 加權平均 150');
  eq(decToFixed(p.qty, 0), '20', 'B 共 20 股');
}

// C. 部分賣出：已實現 = 收入 − 對應成本 − 賣出手續費 − 賣出稅
{
  const p = pos1([
    tx({ quantity: '10', price: '100' }),
    tx({ type: 'sell', quantity: '4', price: '150', fee: '10', tax: '5', tradeDate: 20260102 })
  ], { VOO: { price: '150', updatedAt: 1 } });
  eq(decToFixed(p.realized, 2), '185.00', 'C 已實現 600-400-10-5=185');
  eq(decToFixed(p.qty, 0), '6', 'C 剩 6 股');
  eq(decToFixed(p.cost, 2), '600.00', 'C 剩餘成本 600');
  eq(decToFixed(p.avgCost, 2), '100.00', 'C 剩餘均價仍 100');
  eq(decToFixed(p.sellTax, 2), '5.00', 'C 賣出稅 5');
  eq(p.oversold, false, 'C 未超賣');
}

// D. 全部賣出：qty=0，已實現保留
{
  const { positions } = computePositions([
    tx({ quantity: '10', price: '100' }),
    tx({ type: 'sell', quantity: '10', price: '150', tradeDate: 20260102 })
  ], { VOO: { price: '150', updatedAt: 1 } });
  const p = positions[0];
  eq(decToFixed(p.realized, 2), '500.00', 'D 全賣已實現 +500');
  eq(decToFixed(p.qty, 0), '0', 'D 持有歸零');
  eq(p.price, null, 'D 已結清不顯示市值');
}

// E. 超賣防呆：clamp 到持有量並標記
{
  const p = pos1([
    tx({ quantity: '5', price: '100' }),
    tx({ type: 'sell', quantity: '10', price: '150', tradeDate: 20260102 })
  ], {});
  eq(p.oversold, true, 'E 標記超賣');
  eq(decToFixed(p.realized, 2), '250.00', 'E 只賣掉持有的 5 股：750-500=250');
  eq(decToFixed(p.qty, 0), '0', 'E 賣光');
}

// F. 買→部分賣→再買：均價以剩餘重算
{
  const p = pos1([
    tx({ quantity: '10', price: '100' }),
    tx({ type: 'sell', quantity: '5', price: '150', tradeDate: 20260102 }),
    tx({ quantity: '5', price: '200', tradeDate: 20260103 })
  ], {});
  eq(decToFixed(p.realized, 2), '250.00', 'F 賣出已實現 250');
  eq(decToFixed(p.qty, 0), '10', 'F 最終 10 股');
  eq(decToFixed(p.avgCost, 2), '150.00', 'F 最終均價 (500+1000)/10=150');
}

// G. 幣別彙總：一檔續抱、一檔已結清，已實現皆計入
{
  const txs = [
    tx({ symbol: 'VOO', quantity: '10', price: '100' }),
    tx({ symbol: 'QQQ', quantity: '10', price: '100', name: 'QQQ' }),
    tx({ symbol: 'QQQ', type: 'sell', quantity: '10', price: '130', tradeDate: 20260102, name: 'QQQ' })
  ];
  const { positions } = computePositions(txs, { VOO: { price: '120', updatedAt: 1 } });
  const s = summarizeCurrencies(positions).find(x => x.currency === 'USD');
  eq(decToFixed(s.realized, 2), '300.00', 'G 已結清 QQQ 已實現 +300 計入幣別');
  eq(decToFixed(s.invested, 2), '1000.00', 'G 投入本金只算續抱的 VOO 1000');
  eq(decToFixed(s.unrealized, 2), '200.00', 'G 未實現只算 VOO +200');
  eq(s.heldCount, 1, 'G 續抱檔數 1');
  eq(s.hasSell, true, 'G 有賣出紀錄');
}

// H0. 買入手續費＋稅併入成本（使用者裁決），且仍分別記錄供透明呈現
{
  const p = pos1([tx({ quantity: '10', price: '100', fee: '5', tax: '7' })], {});
  eq(decToFixed(p.cost, 2), '1012.00', 'H0 成本含買入手續費5+稅7');
  eq(decToFixed(p.avgCost, 2), '101.20', 'H0 均價 1012/10=101.20');
  eq(decToFixed(p.buyFees, 2), '5.00', 'H0 買入手續費另記錄');
  eq(decToFixed(p.buyTax, 2), '7.00', 'H0 買入稅另記錄（不再靜默丟失）');
  eq(decToFixed(p.feesAndTax, 2), '12.00', 'H0 手續費/稅統計 = 5+7');
}

// H1. 稽核：部分賣出後成本基礎「守恆」——剩餘成本 + 各次賣出對應成本 = 原始總成本（不漏錢）
{
  // 買 3@100（總成本 300，均價無法整除），逐股賣光
  const { positions } = computePositions([
    tx({ quantity: '3', price: '100' }),
    tx({ type: 'sell', quantity: '1', price: '150', tradeDate: 20260102 }),
    tx({ type: 'sell', quantity: '1', price: '150', tradeDate: 20260103 }),
    tx({ type: 'sell', quantity: '1', price: '150', tradeDate: 20260104 })
  ], {});
  const p = positions[0];
  eq(decToFixed(p.cost, 8), '0.00000000', 'H1 全部賣光後剩餘成本歸零（無殘留、無漏錢）');
  eq(decToFixed(p.realized, 2), '150.00', 'H1 已實現 = 賣出450 − 原始成本300 = 150（守恆）');
}

// ===== P0 驗收條件（含費成本基礎）=====

// AC1：0050 案例 — 2股×105，手續費200，現價105.8 → 投入本金410、均價205、報酬率-48.39%
{
  const p = pos1([tx({ symbol: '0050', currency: 'TWD', market: 'TW', quantity: '2', price: '105', fee: '200' })],
    { '0050': { price: '105.8', updatedAt: 1, stale: false } });
  eq(decToFixed(p.cost, 2), '410.00', 'AC1 投入本金(含費成本基礎)=410');
  eq(decToFixed(p.avgCost, 2), '205.00', 'AC1 均價=205');
  eq(decToFixed(p.unrealizedPct, 2), '-48.39', 'AC1 報酬率=-48.39%（-198.40/410，正確四捨五入；需求書寫-48.38為手算進位差）');
  eq(decToFixed(p.shareCost, 2), '210.00', 'AC1 純股款成本(不含費)=210，供對照');
}

// AC2：手續費為 0 的交易，結果與「純股款」一致（回歸）
{
  const p = pos1([tx({ symbol: 'VT', quantity: '4', price: '100', fee: '0', tax: '0' })], {});
  eq(decToFixed(p.cost, 2), '400.00', 'AC2 手續費0 → 成本=價×量，無變化');
  eq(p.cost, p.shareCost, 'AC2 手續費0 → 含費成本 == 純股款成本');
  eq(decToFixed(p.avgCost, 2), '100.00', 'AC2 手續費0 → 均價=價');
}

// AC3：多筆買入同標的 → 均價=(Σ含費成本)/(Σ股數)，非各筆均價算術平均
{
  const p = pos1([
    tx({ symbol: 'QQQ', quantity: '2', price: '105', fee: '200' }),          // 含費成本410，該筆均價205
    tx({ symbol: 'QQQ', quantity: '8', price: '110', fee: '40', tradeDate: 20260202 }) // 含費成本920，該筆均價115
  ], {});
  eq(decToFixed(p.cost, 2), '1330.00', 'AC3 Σ含費成本=410+920=1330');
  eq(decToFixed(p.avgCost, 2), '133.00', 'AC3 加權均價=1330/10=133（非(205+115)/2=160）');
  eq(decToFixed(p.shareCost, 2), '1090.00', 'AC3 純股款成本=210+880=1090');
}

// AC 附加：純股款成本於部分賣出後按比例扣減
{
  const p = pos1([
    tx({ symbol: 'SPY', quantity: '10', price: '100', fee: '50' }),                 // 含費1050、純股款1000
    tx({ symbol: 'SPY', type: 'sell', quantity: '4', price: '120', tradeDate: 20260202 })
  ], {});
  eq(decToFixed(p.shareCost, 2), '600.00', 'AC附 賣4剩6：純股款 1000×6/10=600');
  eq(decToFixed(p.cost, 2), '630.00', 'AC附 賣4剩6：含費成本 1050×6/10=630');
}

// H. 精度：長小數賣出不產生浮點尾差
{
  const p = pos1([
    tx({ quantity: '3', price: '123.456789012345' }),
    tx({ type: 'sell', quantity: '1', price: '123.456789012345', tradeDate: 20260102 })
  ], {});
  eq(decToFixed(p.realized, 8), '0.00000000', 'H 同價買賣已實現剛好 0，無尾差');
}

// ==================== 已實現事件、換算、退休預估 ====================

// I. realizedEvents：每筆賣出一個事件，含報酬率（對照需求 §五範例）
{
  const { realizedEvents } = computePositions([
    tx({ symbol: 'VOO', quantity: '10', price: '420' }),
    tx({ symbol: 'VOO', type: 'sell', quantity: '5', price: '510', fee: '11.5', tax: '0', tradeDate: 20260710 })
  ], {});
  eq(realizedEvents.length, 1, 'I 一筆賣出 → 一個事件');
  const e = realizedEvents[0];
  eq(decToFixed(e.buyCost, 2), '2100.00', 'I 賣出對應成本 420×5=2100');
  eq(decToFixed(e.proceeds, 2), '2550.00', 'I 賣出收入 510×5=2550');
  eq(decToFixed(e.realized, 2), '438.50', 'I 已實現 2550-2100-11.5=438.50（對照需求範例）');
  eq(decToFixed(e.realizedPct, 2), '20.88', 'I 報酬率 438.5/2100=20.88%（對照需求範例）');
}

// J. 跨幣別換算 TWD
{
  const fx = decParse('32'); // 1 USD = 32 TWD
  eq(decToFixed(toTwdUnits(decParse('100'), 'USD', fx), 2), '3200.00', 'J USD 100 → TWD 3200');
  eq(decToFixed(toTwdUnits(decParse('100'), 'TWD', fx), 2), '100.00', 'J TWD 原值不變');
  eq(toTwdUnits(decParse('100'), 'USD', null), null, 'J USD 無匯率 → null（不假裝換算）');
}

// K. 已實現期間彙總（本月/今年/歷史），USD 事件依匯率換算
{
  const events = [
    { currency: 'TWD', realized: decParse('10000'), tradeDate: 20260705 }, // 本月本年
    { currency: 'TWD', realized: decParse('5000'), tradeDate: 20260112 },  // 今年非本月
    { currency: 'USD', realized: decParse('100'), tradeDate: 20260706 },   // 本月，×32=3200
    { currency: 'TWD', realized: decParse('9999'), tradeDate: 20251230 }   // 去年
  ];
  const r = aggregateRealized(events, 20260713, decParse('32'));
  eq(decToFixed(r.month, 2), '13200.00', 'K 本月 = 10000 + 100USD×32');
  eq(decToFixed(r.year, 2), '18200.00', 'K 今年 = 10000+5000+3200');
  eq(decToFixed(r.all, 2), '28199.00', 'K 歷史全部含去年 9999');
  eq(r.fxMissing, false, 'K 有匯率不缺');
}
{
  const r = aggregateRealized([{ currency: 'USD', realized: decParse('100'), tradeDate: 20260706 }], 20260713, null);
  eq(r.fxMissing, true, 'K USD 事件無匯率 → 標記 fxMissing 且不計入');
  eq(decToFixed(r.all, 2), '0.00', 'K 無法換算的事件不硬加');
}

// L. 退休複利預估
{
  const r = projectRetirement(3250000, 30000, 7, 20000000);
  eq(r.reachable, true, 'L 可達標');
  eq(Math.round(r.years * 10) / 10, 15.7, 'L 約 15.7 年（複利模型）');
  eq(r.days > 5000 && r.days < 6500, true, 'L 天數落在合理區間');
}
{
  eq(projectRetirement(25000000, 0, 7, 20000000).alreadyReached, true, 'L 已達標');
  eq(projectRetirement(0, 0, 7, 20000000).reachable, false, 'L 無本金無投入無法達標');
  const zeroRate = projectRetirement(0, 100000, 0, 1200000);
  eq(Math.round(zeroRate.months), 12, 'L 0% 報酬：120萬÷月10萬=12個月');
}

console.log(`money-math: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

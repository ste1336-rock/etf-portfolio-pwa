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
const { decParse, decAdd, decSub, decMul, decDiv, decToFixed, decFormat, decFormatQty, DEC_HUNDRED, DEC_ZERO } = moduleObj.exports;

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

// --- 極大值 ---
eq(decFormat(decParse('999999999999.99'), 2), '999,999,999,999.99', '極大金額不失真');

console.log(`money-math: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

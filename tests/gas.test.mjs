// 測試 Apps Script 純函式（民國曆轉換、日期數字驗證、數字字串驗證）。
// 從 apps-script/Code.gs 抽出真實原始碼實跑（stub 掉 GAS 全域物件）。
// 執行：node tests/gas.test.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = readFileSync(path.join(root, 'apps-script', 'Code.gs'), 'utf8');

const ctx = {
  SpreadsheetApp: {}, PropertiesService: {}, UrlFetchApp: {}, ContentService: {},
  console, Date, JSON, Math, Number, String, Array, Object, isFinite
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

let passed = 0, failed = 0;
function eq(actual, expected, label) {
  if (String(actual) === String(expected)) { passed++; }
  else { failed++; console.error(`FAIL: ${label}\n  expected: ${expected}\n  actual:   ${actual}`); }
}

// --- 民國曆轉換（教訓正本：'1150709' = 2026-07-09）---
const ms = ctx.parseROCDateToMs_('1150709');
const d = new Date(ms);
eq(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, '2026-7-9', "ROC '1150709' → 2026-07-09");
eq(ctx.parseROCDateToMs_('115709'), null, '6 位民國日期 → null（格式不符）');
eq(ctx.parseROCDateToMs_('1151332'), null, '13 月 32 日 → null');
eq(ctx.parseROCDateToMs_(''), null, '空字串 → null');
eq(ctx.parseROCDateToMs_('abcdefg'), null, '非數字 → null');
const ms2 = ctx.parseROCDateToMs_('1130229'); // 2024 閏年 2/29 合法
eq(new Date(ms2).getDate(), 29, '民國 113/02/29（2024 閏年）合法');
eq(ctx.parseROCDateToMs_('1140229'), null, '民國 114/02/29（2025 非閏年）→ null');

// --- tradeDate 純數字驗證 ---
eq(ctx.isValidDateNumber_(20260712), true, '20260712 合法');
eq(ctx.isValidDateNumber_(20260231), false, '2 月 31 日不合法');
eq(ctx.isValidDateNumber_(20261301), false, '13 月不合法');
eq(ctx.isValidDateNumber_(2026071), false, '7 位數不合法');
eq(ctx.isValidDateNumber_(20260712.5), false, '小數不合法');
eq(ctx.isValidDateNumber_(NaN), false, 'NaN 不合法');
eq(ctx.isValidDateNumber_(20240229), true, '2024/02/29 閏年合法');

// --- 數字字串驗證 ---
eq(ctx.parseDecimalString_('620.00', false, 1e7), '620.00', '合法價格回傳原字串（保留精度）');
eq(ctx.parseDecimalString_('0', false, 1e7), null, '價格 0 不合法');
eq(ctx.parseDecimalString_('0', true, 1e7), '0', '手續費 0 合法');
eq(ctx.parseDecimalString_('-5', true, 1e7), null, '負數不合法');
eq(ctx.parseDecimalString_('1e5', false, 1e7), null, '科學記號不合法');
eq(ctx.parseDecimalString_('99999999999', false, 1e7), null, '超過上限不合法');
eq(ctx.parseDecimalString_('abc', false, 1e7), null, '非數字不合法');
eq(ctx.parseDecimalString_('123.456789012345', false, 1e7), '123.456789012345', '長小數原樣保留（不經 Number 轉換損失）');

console.log(`gas-helpers: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

/**
 * ETF 投資追蹤 PWA — Google Apps Script 後端
 *
 * 安裝步驟（只做一次）：
 * 1. 建立一份新的 Google Sheet（名稱建議：ETF_Portfolio_PWA）。
 * 2. 擴充功能 → Apps Script，把本檔全部內容貼進 Code.gs（覆蓋原本內容）。
 * 3. 在編輯器上方函式選單選「setup」→ 按「執行」→ 授權（會自動建立三個分頁與標題列）。
 * 4. 左側齒輪「專案設定」→ 最下方「指令碼屬性」→ 新增屬性：
 *      屬性名稱：SECRET_KEY
 *      值：你自己想的一長串亂碼（例如 30 個以上英數字，之後要填進手機 App）
 * 5. 右上「部署」→「新增部署作業」→ 類型選「網頁應用程式」：
 *      執行身分：我
 *      具有存取權的使用者：所有人
 *    → 部署 → 複製「網頁應用程式 URL」（以 /exec 結尾），填進 App 的設定頁。
 *
 * ⚠️ 每次修改本檔之後，必須「部署 → 管理部署作業 → 鉛筆編輯 → 版本選『新版本』→ 部署」
 *    才會生效。只按儲存不會更新線上 API。
 */

var TX_SHEET = 'Transactions';
var PRICE_SHEET = 'Prices';
var SETTINGS_SHEET = 'Settings';

// type/tax 接在最後（M/N 欄），不動既有 A–L 欄位；舊資料 type 空 → 視為 buy、tax 空 → 0。
var TX_HEADERS = ['id', 'tradeDate', 'symbol', 'name', 'market', 'price', 'quantity', 'fee', 'currency', 'note', 'createdAt', 'updatedAt', 'type', 'tax'];
var PRICE_HEADERS = ['symbol', 'price', 'currency', 'updatedAt', 'dataSource'];
var SETTINGS_HEADERS = ['key', 'value'];

// ===== 入口 =====

function doGet(e) {
  // 只回報服務存活，不回傳任何資料（資料一律走 doPost + Key 驗證）
  return jsonOutput_({ ok: true, service: 'etf-portfolio-api', time: Date.now() });
}

function doPost(e) {
  try {
    var req;
    try {
      req = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return jsonOutput_({ ok: false, error: 'bad request' });
    }
    if (!isAuthorized_(req.key)) {
      return jsonOutput_({ ok: false, error: 'unauthorized' });
    }
    switch (req.action) {
      case 'ping':
        return jsonOutput_({ ok: true, time: Date.now() });
      case 'listTransactions':
        return jsonOutput_({ ok: true, transactions: listTransactions_() });
      case 'addTransaction':
        return jsonOutput_(addTransaction_(req.payload));
      case 'updateTransaction':
        return jsonOutput_(updateTransaction_(req.payload));
      case 'deleteTransaction':
        return jsonOutput_(deleteTransaction_(req.payload));
      case 'getPrices':
        return jsonOutput_({ ok: true, prices: getPrices_(req.payload && req.payload.symbols) });
      default:
        return jsonOutput_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    // 不把內部堆疊回傳給前端，只給一般化訊息
    return jsonOutput_({ ok: false, error: 'server error' });
  }
}

// ===== 初始化（手動執行一次）=====

function setup() {
  var ss = SpreadsheetApp.getActive();
  var tx = ensureSheet_(ss, TX_SHEET, TX_HEADERS);
  var px = ensureSheet_(ss, PRICE_SHEET, PRICE_HEADERS);
  ensureSheet_(ss, SETTINGS_SHEET, SETTINGS_HEADERS);
  // 把可能是「全數字」的文字欄位整欄設為純文字，避免 Sheets 把 '0050' 轉成數字 50（吃掉前導零）。
  // 這是與日期陷阱同一家族的雷；symbol=C、name=D、note=J。
  tx.getRange('C:C').setNumberFormat('@');
  tx.getRange('D:D').setNumberFormat('@');
  tx.getRange('J:J').setNumberFormat('@');
  tx.getRange('M:M').setNumberFormat('@'); // type (buy/sell)
  px.getRange('A:A').setNumberFormat('@'); // Prices.symbol
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var hasHeaders = firstRow.every(function (v, i) { return String(v) === headers[i]; });
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function mustSheet_(name) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sheet) throw new Error('missing sheet: ' + name + '（請先執行 setup）');
  return sheet;
}

// ===== 驗證 =====

function isAuthorized_(key) {
  var stored = PropertiesService.getScriptProperties().getProperty('SECRET_KEY');
  if (!stored || stored.length < 12) return false; // 未設定或太短一律拒絕
  if (typeof key !== 'string' || key.length !== stored.length) return false;
  var diff = 0;
  for (var i = 0; i < stored.length; i++) {
    diff |= key.charCodeAt(i) ^ stored.charCodeAt(i);
  }
  return diff === 0;
}

// ===== 交易 =====

function listTransactions_() {
  var sheet = mustSheet_(TX_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, TX_HEADERS.length).getValues();
  var out = [];
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    if (!r[0]) continue; // 空列跳過
    out.push({
      id: String(r[0]),
      tradeDate: Number(r[1]),
      symbol: String(r[2]),
      name: String(r[3]),
      market: String(r[4]),
      // 金額欄位一律轉字串回傳，前端用字串解析做定點運算，避免浮點尾差
      price: String(r[5]),
      quantity: String(r[6]),
      fee: String(r[7]),
      currency: String(r[8]),
      note: String(r[9]),
      createdAt: Number(r[10]),
      updatedAt: Number(r[11]),
      type: String(r[12] || '').toLowerCase() === 'sell' ? 'sell' : 'buy', // 舊資料空 → buy
      tax: String(r[13] === '' || r[13] == null ? '0' : r[13])
    });
  }
  return out;
}

/** 驗證交易 payload；回 { ok:true, tx:{...} } 或 { ok:false, error }。add/update 共用。 */
function validateTxPayload_(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'missing payload' };

  var id = String(p.id || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return { ok: false, error: 'invalid id (need UUID)' };
  }
  var tradeDate = Number(p.tradeDate);
  if (!isValidDateNumber_(tradeDate)) return { ok: false, error: 'invalid tradeDate' };

  var symbol = String(p.symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9.]{1,16}$/.test(symbol)) return { ok: false, error: 'invalid symbol' };

  var name = String(p.name || '').trim().slice(0, 80);

  var market = String(p.market || '').trim().toUpperCase();
  if (market !== 'US' && market !== 'TW') return { ok: false, error: 'invalid market' };

  var price = parseDecimalString_(p.price, false, 10000000);
  if (price === null) return { ok: false, error: 'invalid price' };
  var quantity = parseDecimalString_(p.quantity, false, 1000000000);
  if (quantity === null) return { ok: false, error: 'invalid quantity' };
  var fee = parseDecimalString_(p.fee === undefined || p.fee === '' ? '0' : p.fee, true, 10000000);
  if (fee === null) return { ok: false, error: 'invalid fee' };
  var tax = parseDecimalString_(p.tax === undefined || p.tax === '' ? '0' : p.tax, true, 10000000);
  if (tax === null) return { ok: false, error: 'invalid tax' };

  var currency = String(p.currency || '').trim().toUpperCase();
  if (currency !== 'USD' && currency !== 'TWD') return { ok: false, error: 'invalid currency' };

  var type = String(p.type || 'buy').trim().toLowerCase();
  if (type !== 'buy' && type !== 'sell') return { ok: false, error: 'invalid type' };

  var note = String(p.note || '').slice(0, 200);

  return { ok: true, tx: {
    id: id, tradeDate: tradeDate, symbol: symbol, name: name, market: market,
    price: Number(price), quantity: Number(quantity), fee: Number(fee), currency: currency,
    note: note, type: type, tax: Number(tax)
  } };
}

/** 依 id 找出資料列（1-based，含標題列）；找不到回 -1。 */
function findTxRow_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).toLowerCase() === id) return i + 2;
  }
  return -1;
}

/** 把一列的文字欄位（symbol/name/note/type）強制設為純文字，避免 '0050' 被轉成數字 50。 */
function forceTextCols_(sheet, row) {
  sheet.getRange(row, 3).setNumberFormat('@'); // symbol (C)
  sheet.getRange(row, 4).setNumberFormat('@'); // name (D)
  sheet.getRange(row, 10).setNumberFormat('@'); // note (J)
  sheet.getRange(row, 13).setNumberFormat('@'); // type (M)
}

function addTransaction_(p) {
  var v = validateTxPayload_(p);
  if (!v.ok) return v;
  var t = v.tx;

  var sheet = mustSheet_(TX_SHEET);
  if (findTxRow_(sheet, t.id) !== -1) return { ok: false, error: 'duplicate id' };

  var now = Date.now();
  var targetRow = sheet.getLastRow() + 1;
  forceTextCols_(sheet, targetRow);
  // tradeDate 存純數字（20260712），createdAt/updatedAt 存 epoch 毫秒數字，
  // 全程不寫入日期字串，避免 Google Sheets 自動轉成日期物件
  sheet.getRange(targetRow, 1, 1, TX_HEADERS.length).setValues([[
    t.id, t.tradeDate, t.symbol, t.name, t.market, t.price, t.quantity, t.fee, t.currency, t.note, now, now, t.type, t.tax
  ]]);
  return { ok: true, id: t.id };
}

function updateTransaction_(p) {
  var v = validateTxPayload_(p);
  if (!v.ok) return v;
  var t = v.tx;

  var sheet = mustSheet_(TX_SHEET);
  var row = findTxRow_(sheet, t.id);
  if (row === -1) return { ok: false, error: 'not found' };

  // 保留原始 createdAt（原始交易不可被覆蓋改寫其建立時間），只更新 updatedAt。
  var createdAt = Number(sheet.getRange(row, 11).getValue()) || Date.now();
  var now = Date.now();
  forceTextCols_(sheet, row);
  sheet.getRange(row, 1, 1, TX_HEADERS.length).setValues([[
    t.id, t.tradeDate, t.symbol, t.name, t.market, t.price, t.quantity, t.fee, t.currency, t.note, createdAt, now, t.type, t.tax
  ]]);
  return { ok: true, id: t.id };
}

function deleteTransaction_(p) {
  var id = String(p && p.id || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
    return { ok: false, error: 'invalid id' };
  }
  var sheet = mustSheet_(TX_SHEET);
  var row = findTxRow_(sheet, id);
  if (row === -1) return { ok: false, error: 'not found' };
  sheet.deleteRow(row);
  return { ok: true, id: id };
}

/**
 * 驗證數字字串：^\d+(\.\d+)?$，回傳原字串（不是 Number），呼叫端自行決定精度處理。
 * allowZero=false 時要求 > 0；超過 max 視為無效。
 */
function parseDecimalString_(v, allowZero, max) {
  var s = String(v === undefined || v === null ? '' : v).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  var n = Number(s);
  if (!isFinite(n)) return null;
  if (!allowZero && !(n > 0)) return null;
  if (allowZero && n < 0) return null;
  if (n > max) return null;
  return s;
}

/** tradeDate 純數字格式驗證：20260712 → 2026-07-12 必須是真實存在的日期 */
function isValidDateNumber_(n) {
  if (!isFinite(n) || Math.floor(n) !== n) return false;
  if (n < 19000101 || n > 21001231) return false;
  var y = Math.floor(n / 10000);
  var m = Math.floor(n / 100) % 100;
  var d = n % 100;
  var dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// ===== 報價（代理 + 快取）=====

/**
 * symbols: [{symbol:'VOO', market:'US'}, {symbol:'0050', market:'TW'}]
 * 美股：Yahoo chart endpoint。台股：TWSE OpenAPI（日終），失敗備援 Yahoo .TW。
 * 成功 → 寫入 Prices 分頁快取，stale=false。
 * 失敗 → 回快取的最後成功價，stale=true；連快取都沒有 → error。
 */
function getPrices_(symbols) {
  if (!Array.isArray(symbols)) return [];
  symbols = symbols.slice(0, 30); // 防濫用上限
  var twseMap = null; // 整批只抓一次 TWSE 全市場清單
  var out = [];
  for (var i = 0; i < symbols.length; i++) {
    var s = symbols[i] || {};
    var symbol = String(s.symbol || '').trim().toUpperCase();
    var market = String(s.market || '').trim().toUpperCase();
    if (!/^[A-Z0-9.]{1,16}$/.test(symbol) || (market !== 'US' && market !== 'TW')) {
      out.push({ symbol: symbol, market: market, stale: true, error: 'invalid symbol/market' });
      continue;
    }
    var fresh = null;
    try {
      if (market === 'TW') {
        if (twseMap === null) twseMap = fetchTwseMap_();
        fresh = twseMap[symbol] || null;
        if (!fresh) fresh = fetchYahooQuote_(symbol + '.TW');
      } else {
        fresh = fetchYahooQuote_(symbol);
      }
    } catch (err) {
      fresh = null;
    }
    if (fresh && fresh.price > 0) {
      savePriceCache_(symbol, fresh);
      out.push({
        symbol: symbol, market: market,
        price: String(fresh.price), currency: fresh.currency,
        updatedAt: fresh.updatedAt, dataSource: fresh.dataSource, stale: false
      });
    } else {
      var cached = readPriceCache_(symbol);
      if (cached) {
        out.push({
          symbol: symbol, market: market,
          price: String(cached.price), currency: cached.currency,
          updatedAt: cached.updatedAt, dataSource: cached.dataSource, stale: true
        });
      } else {
        out.push({ symbol: symbol, market: market, stale: true, error: 'no data' });
      }
    }
  }
  return out;
}

/** TWSE OpenAPI 全市場日終資料 → { '0050': {price, currency, updatedAt, dataSource} } */
function fetchTwseMap_() {
  var map = {};
  try {
    var res = UrlFetchApp.fetch('https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL', {
      muteHttpExceptions: true,
      followRedirects: true
    });
    if (res.getResponseCode() !== 200) return map;
    var rows = JSON.parse(res.getContentText());
    if (!Array.isArray(rows)) return map;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var code = String(r.Code || '').trim();
      var priceStr = String(r.ClosingPrice || '').replace(/,/g, '').trim();
      if (!code || priceStr === '' || priceStr === '--') continue; // 暫停交易等無價證券
      var price = Number(priceStr);
      if (!(price > 0)) continue;
      var dateMs = parseROCDateToMs_(String(r.Date || ''));
      map[code] = {
        price: price,
        currency: 'TWD',
        updatedAt: dateMs !== null ? dateMs : Date.now(),
        dataSource: 'twse'
      };
    }
  } catch (err) {
    // 回空 map，讓呼叫端走 Yahoo .TW 備援
  }
  return map;
}

/** 民國曆 '1150709' → 2026-07-09 當日 00:00 的 epoch 毫秒；格式錯誤回 null */
function parseROCDateToMs_(s) {
  if (!/^\d{7}$/.test(s)) return null;
  var y = Number(s.slice(0, 3)) + 1911;
  var m = Number(s.slice(3, 5));
  var d = Number(s.slice(5, 7));
  var dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt.getTime();
}

/** Yahoo Finance 非官方 chart endpoint（伺服器端代理，繞過瀏覽器 CORS） */
function fetchYahooQuote_(ticker) {
  var url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(ticker);
  var res = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }
  });
  if (res.getResponseCode() !== 200) return null;
  var data = JSON.parse(res.getContentText());
  var result = data && data.chart && data.chart.result && data.chart.result[0];
  var meta = result && result.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number' || !(meta.regularMarketPrice > 0)) return null;
  return {
    price: meta.regularMarketPrice,
    currency: String(meta.currency || ''),
    updatedAt: typeof meta.regularMarketTime === 'number' ? meta.regularMarketTime * 1000 : Date.now(),
    dataSource: 'yahoo'
  };
}

// ===== Prices 分頁快取 =====

function savePriceCache_(symbol, quote) {
  var sheet = mustSheet_(PRICE_SHEET);
  var row = [symbol, quote.price, quote.currency, quote.updatedAt, quote.dataSource];
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var syms = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < syms.length; i++) {
      if (String(syms[i][0]) === symbol) {
        sheet.getRange(i + 2, 1).setNumberFormat('@'); // symbol 保純文字
        sheet.getRange(i + 2, 1, 1, PRICE_HEADERS.length).setValues([row]);
        return;
      }
    }
  }
  var targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1).setNumberFormat('@'); // symbol 欄保純文字，避免 '0050' → 50
  sheet.getRange(targetRow, 1, 1, PRICE_HEADERS.length).setValues([row]);
}

function readPriceCache_(symbol) {
  var sheet = mustSheet_(PRICE_SHEET);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, PRICE_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) === symbol) {
      var price = Number(values[i][1]);
      if (!(price > 0)) return null;
      return {
        price: price,
        currency: String(values[i][2]),
        updatedAt: Number(values[i][3]),
        dataSource: String(values[i][4])
      };
    }
  }
  return null;
}

// ===== 共用 =====

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

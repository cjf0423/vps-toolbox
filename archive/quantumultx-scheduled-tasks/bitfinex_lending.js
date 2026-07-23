/*
 * Bitfinex 自动放贷脚本 - 通用版（QuanX / Surge / Loon / Node）
 *
 * 说明：
 * - 保留 FRR 正偏移用 FRRDELTAVAR、负偏移用 LIMIT 模拟 的思路
 * - 兼容 Quantumult X / Surge / Loon / Node.js
 * - 使用 Env 封装网络、持久化、通知、日志
 * - 重点修复：nonce 单调递增，避免 Bitfinex `nonce: small`
 *
 * 推荐配置项（BoxJS / 持久化键）：
 * bfx_api_key
 * bfx_api_secret
 * bfx_symbol
 * bfx_use_frr
 * bfx_frr_offset_pct_day
 * bfx_fixed_rate_pct_day
 * bfx_period
 * bfx_reserve_amount
 * bfx_min_offer
 * bfx_max_offer
 * bfx_rate_change_threshold_pct_day
 * bfx_amount_change_threshold
 * bfx_min_annual_rate
 * bfx_dry_run
 * bfx_debug
 */

const $ = new Env("Bitfinex 自动放贷");

const API_KEY = $.getdata("bfx_api_key") || "";
const API_SECRET = $.getdata("bfx_api_secret") || "";
const SYMBOL = $.getdata("bfx_symbol") || "fUSD";
const USE_FRR = ($.getdata("bfx_use_frr") || "true") === "true";
const FRR_OFFSET_PCT_DAY = parseFloat($.getdata("bfx_frr_offset_pct_day") || "0");
const FIXED_RATE_PCT_DAY = parseFloat($.getdata("bfx_fixed_rate_pct_day") || "0.018");
const PERIOD = parseInt($.getdata("bfx_period") || "2", 10);
const RESERVE_AMOUNT = parseFloat($.getdata("bfx_reserve_amount") || "0");
const MIN_OFFER = parseFloat($.getdata("bfx_min_offer") || "150");
const MAX_OFFER = parseFloat($.getdata("bfx_max_offer") || "0");
const RATE_CHANGE_THRESHOLD_PCT_DAY = parseFloat($.getdata("bfx_rate_change_threshold_pct_day") || "0.002");
const AMOUNT_CHANGE_THRESHOLD = parseFloat($.getdata("bfx_amount_change_threshold") || "1");
const MIN_ANNUAL_RATE = parseFloat($.getdata("bfx_min_annual_rate") || "0");
const DRY_RUN = ($.getdata("bfx_dry_run") || "false") === "true";
const DEBUG = ($.getdata("bfx_debug") || "false") === "true";

const API_BASE = "https://api.bitfinex.com";
const PUBLIC_BASE = "https://api-pub.bitfinex.com";
let lastNonce = 0;

function log(msg) { $.log("[✅] " + msg); }
function debug(msg) { if (DEBUG) $.log("[DEBUG] " + msg); }
function finishWithLog(title) {
  $.msg($.name + " - " + title, "", $.logs.join("\n"));
  $.done();
}
function fail(msg) {
  log("错误❌: " + msg);
  finishWithLog("失败");
}

function fmtNum(n, d) {
  if (!isFinite(n)) return String(n);
  return Number(n).toFixed(d);
}
function dayRateToAnnual(dayRateDecimal) { return dayRateDecimal * 365; }
function pctDayToDecimal(pctDay) { return pctDay / 100; }
function decimalToPctDay(rateDecimal) { return rateDecimal * 100; }
function annualDecimalToPct(annualDecimal) { return annualDecimal * 100; }
function clampMin(v, min) { return v < min ? min : v; }
function roundDown(value, decimals) {
  const f = Math.pow(10, decimals);
  return Math.floor(value * f) / f;
}
function safeJson(obj) {
  try { return JSON.stringify(obj); } catch (e) { return String(obj); }
}
function nextNonce() {
  const now = Date.now();
  if (now <= lastNonce) lastNonce += 1;
  else lastNonce = now;
  return String(lastNonce);
}

function validateConfig() {
  if (!API_KEY) return "缺少 bfx_api_key";
  if (!API_SECRET) return "缺少 bfx_api_secret";
  if (!/^f[A-Z0-9]+$/.test(SYMBOL)) return "bfx_symbol 格式异常，应类似 fUSD / fUSDT";
  if (!isFinite(PERIOD) || PERIOD <= 0) return "bfx_period 必须大于 0";
  if (!isFinite(RESERVE_AMOUNT) || RESERVE_AMOUNT < 0) return "bfx_reserve_amount 不能小于 0";
  if (!isFinite(MIN_OFFER) || MIN_OFFER <= 0) return "bfx_min_offer 必须大于 0";
  if (!isFinite(MAX_OFFER) || MAX_OFFER < 0) return "bfx_max_offer 不能小于 0";
  if (!isFinite(MIN_ANNUAL_RATE) || MIN_ANNUAL_RATE < 0) return "bfx_min_annual_rate 不能小于 0";
  if (!isFinite(FRR_OFFSET_PCT_DAY)) return "bfx_frr_offset_pct_day 不是合法数字";
  if (!isFinite(FIXED_RATE_PCT_DAY) || FIXED_RATE_PCT_DAY < 0) return "bfx_fixed_rate_pct_day 不能小于 0";
  if (!isFinite(RATE_CHANGE_THRESHOLD_PCT_DAY) || RATE_CHANGE_THRESHOLD_PCT_DAY < 0) return "bfx_rate_change_threshold_pct_day 不能小于 0";
  if (!isFinite(AMOUNT_CHANGE_THRESHOLD) || AMOUNT_CHANGE_THRESHOLD < 0) return "bfx_amount_change_threshold 不能小于 0";
  return "";
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    $.get({ url }, (err, resp, body) => {
      if (err) return reject(err);
      resolve({ resp, body });
    });
  });
}

function httpPost(url, headers, body) {
  return new Promise((resolve, reject) => {
    $.post({ url, headers, body }, (err, resp, bodyText) => {
      if (err) return reject(err);
      resolve({ resp, body: bodyText });
    });
  });
}

async function authPost(path, bodyObj) {
  const nonce = nextNonce();
  const bodyJson = JSON.stringify(bodyObj || {});
  const sigPayload = "/api" + path + nonce + bodyJson;
  const signature = hmacSha384Hex(API_SECRET, sigPayload);
  debug("POST " + path + " nonce=" + nonce + " body=" + bodyJson);

  const { resp, body } = await httpPost(API_BASE + path, {
    "Content-Type": "application/json",
    "bfx-apikey": API_KEY,
    "bfx-nonce": nonce,
    "bfx-signature": signature,
    "User-Agent": "bitfinex-lending-universal/1.0"
  }, bodyJson);

  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error("解析失败: " + String(body).slice(0, 120));
  }
  debug("RESP " + path + " code=" + (resp && (resp.statusCode || resp.status)) + " body=" + safeJson(data).slice(0, 500));
  if (Array.isArray(data) && data[6] === "ERROR") throw new Error("API错误: " + data[7]);
  if (Array.isArray(data) && data[0] === "error") throw new Error("API错误: " + safeJson(data));
  return data;
}

async function getCurrentFrr() {
  const url = PUBLIC_BASE + "/v2/tickers?symbols=" + encodeURIComponent(SYMBOL);
  const { resp, body } = await httpGet(url);
  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    throw new Error("FRR解析失败: " + String(body).slice(0, 120));
  }
  debug("FRR raw code=" + (resp && (resp.statusCode || resp.status)) + " body=" + safeJson(data).slice(0, 300));
  if (!Array.isArray(data) || !data[0] || data[0][1] === undefined) {
    throw new Error("FRR返回异常: " + String(body).slice(0, 120));
  }
  const frr = parseFloat(data[0][1]);
  if (!isFinite(frr) || frr <= 0) throw new Error("FRR值异常: " + data[0][1]);
  return { frr, raw: data[0] };
}

function findFundingBalance(wallets, currency) {
  if (!Array.isArray(wallets)) return NaN;
  for (let i = 0; i < wallets.length; i++) {
    const row = wallets[i];
    if (!row || row.length < 5) continue;
    if (row[0] === "funding" && row[1] === currency) {
      const v = row[4] !== null && row[4] !== undefined ? row[4] : row[2];
      const num = parseFloat(v);
      if (isFinite(num)) return num;
    }
  }
  return NaN;
}

function summarizeCredits(credits) {
  if (!Array.isArray(credits) || credits.length === 0) {
    return { count: 0, totalAmount: 0, lines: [] };
  }

  let totalAmount = 0;
  const lines = [];

  for (let i = 0; i < credits.length; i++) {
    const row = credits[i];
    if (!Array.isArray(row)) continue;

    const amount = Math.abs(parseFloat(row[5]));
    const rate = parseFloat(row[11]);
    const period = parseInt(row[12], 10);

    if (isFinite(amount)) totalAmount += amount;

    lines.push(
      "已成交😄" + (i + 1) +
      " 💰金额=" + (isFinite(amount) ? fmtNum(amount, 8) : "?") +
      " 🤑利率=" + (isFinite(rate) ? fmtNum(decimalToPctDay(rate), 6) + "%/天" : "?") +
      " ⌚️年化≈" + (isFinite(rate) ? fmtNum(annualDecimalToPct(dayRateToAnnual(rate)), 2) + "%" : "?") +
      " 🔁周期=" + (isFinite(period) ? period + "天" : "?")
    );
  }

  return {
    count: lines.length,
    totalAmount: totalAmount,
    lines: lines
  };
}

function calcTargetRate(frr) {
  if (!isFinite(frr) || frr <= 0) return { error: "FRR 非法，无法计算目标利率" };

  if (USE_FRR && FRR_OFFSET_PCT_DAY >= 0) {
    const offset = pctDayToDecimal(FRR_OFFSET_PCT_DAY);
    const targetFrrBased = frr + offset;
    return {
      offerType: "FRRDELTAVAR",
      offerRate: offset,
      annualRate: dayRateToAnnual(targetFrrBased),
      rateDesc: "FRRDELTAVAR 偏移 +" + fmtNum(FRR_OFFSET_PCT_DAY, 6) + "%/天（预计目标≈" + fmtNum(annualDecimalToPct(dayRateToAnnual(targetFrrBased)), 2) + "%/年）"
    };
  }

  if (USE_FRR && FRR_OFFSET_PCT_DAY < 0) {
    const simulatedRate = clampMin(frr + pctDayToDecimal(FRR_OFFSET_PCT_DAY), 0.000001);
    return {
      offerType: "LIMIT",
      offerRate: simulatedRate,
      annualRate: dayRateToAnnual(simulatedRate),
      rateDesc: "LIMIT 模拟 FRR" + fmtNum(FRR_OFFSET_PCT_DAY, 6) + "%/天 => " + fmtNum(decimalToPctDay(simulatedRate), 6) + "%/天（年化≈" + fmtNum(annualDecimalToPct(dayRateToAnnual(simulatedRate)), 2) + "%）"
    };
  }

  const fixedRateDecimal = clampMin(pctDayToDecimal(FIXED_RATE_PCT_DAY), 0.000001);
  return {
    offerType: "LIMIT",
    offerRate: fixedRateDecimal,
    annualRate: dayRateToAnnual(fixedRateDecimal),
    rateDesc: "LIMIT 固定 " + fmtNum(FIXED_RATE_PCT_DAY, 6) + "%/天（年化≈" + fmtNum(annualDecimalToPct(dayRateToAnnual(fixedRateDecimal)), 2) + "%）"
  };
}

function needsReorder(offers, targetType, targetRate, targetAmount) {
  if (!offers || offers.length === 0) return { need: true, reason: "当前无挂单" };
  if (offers.length > 1) return { need: true, reason: "当前有 " + offers.length + " 笔挂单，脚本策略要求合并为 1 笔" };

  const o = offers[0];
  const exType = o[6];
  const exAmount = Math.abs(parseFloat(o[4]));
  const exRate = parseFloat(o[14]);
  const exPeriod = parseInt(o[15], 10);

  debug("existing offer type=" + exType + " amount=" + exAmount + " rate=" + exRate + " period=" + exPeriod);

  if (exType !== targetType) return { need: true, reason: "挂单类型变化：" + exType + " -> " + targetType };
  if (exPeriod !== PERIOD) return { need: true, reason: "挂单周期变化：" + exPeriod + " -> " + PERIOD + "天" };
  if (!isFinite(exAmount) || Math.abs(exAmount - targetAmount) > AMOUNT_CHANGE_THRESHOLD) {
    return { need: true, reason: "挂单金额变化超过阈值：" + fmtNum(exAmount, 2) + " -> " + fmtNum(targetAmount, 2) };
  }
  if (targetType === "FRRDELTAVAR") {
    return Math.abs(exRate - targetRate) < 1e-12
      ? { need: false, reason: "FRR 偏移参数无变化" }
      : { need: true, reason: "FRR 偏移参数变化：" + exRate + " -> " + targetRate };
  }
  const changePctDay = Math.abs(exRate - targetRate) * 100;
  return changePctDay > RATE_CHANGE_THRESHOLD_PCT_DAY
    ? { need: true, reason: "固定利率变动 " + fmtNum(changePctDay, 6) + "%/天，超过阈值 " + fmtNum(RATE_CHANGE_THRESHOLD_PCT_DAY, 6) + "%/天" }
    : { need: false, reason: "固定利率变动 " + fmtNum(changePctDay, 6) + "%/天，未超过阈值" };
}

async function step4Submit(target) {
  const currency = SYMBOL.replace(/^f/, "");
  const wallets = await authPost("/v2/auth/r/wallets", {});
  const bal = findFundingBalance(wallets, currency);
  if (!isFinite(bal)) throw new Error("撤单后未找到 funding 钱包余额: " + currency);

  let available = bal - RESERVE_AMOUNT;
  if (MAX_OFFER > 0) available = Math.min(available, MAX_OFFER);
  available = roundDown(available, 8);

  log("撤单后可贷: " + fmtNum(available, 8));
  if (available <= 0) {
    log("可贷金额 <= 0，跳过");
    return finishWithLog("跳过");
  }
  if (available < MIN_OFFER) {
    log("可贷金额低于最小挂单额 " + fmtNum(MIN_OFFER, 2) + "，跳过");
    return finishWithLog("跳过");
  }
  if (MIN_ANNUAL_RATE > 0 && target.annualRate < MIN_ANNUAL_RATE) {
    log("目标年化低于门槛，撤单后仍跳过下单");
    return finishWithLog("跳过");
  }

  const payload = {
    type: target.offerType,
    symbol: SYMBOL,
    amount: String(available),
    rate: String(roundDown(target.offerRate, 10)),
    period: PERIOD,
    flags: 0
  };

  log("准备下单: " + payload.type + " | 金额=" + payload.amount + " | 利率=" + payload.rate + " | 周期=" + PERIOD + "天");
  log("目标收益: " + fmtNum(decimalToPctDay(target.offerRate), 6) + "%/天 | 年化≈" + fmtNum(annualDecimalToPct(target.annualRate), 2) + "%");
  debug("submit payload=" + safeJson(payload));

  if (DRY_RUN) return log("[DRY RUN] 跳过真实下单");

  const result = await authPost("/v2/auth/w/funding/offer/submit", payload);
  debug("submit result=" + safeJson(result).slice(0, 500));
  log("下单成功: " + target.rateDesc + " | 金额=" + payload.amount + " | 利率=" + payload.rate + " | 周期=" + PERIOD + "天");
  return finishWithLog("下单成功");
}

async function main() {
  log(new Date().toLocaleString("zh-CN"));
  const cfgErr = validateConfig();
  if (cfgErr) return fail(cfgErr);

  log("SYMBOL=" + SYMBOL + " PERIOD=" + PERIOD + "天 USE_FRR=" + USE_FRR + (DRY_RUN ? " DRY_RUN=true" : ""));

  try {
    const { frr, raw } = await getCurrentFrr();
    log("当前FRR: " + fmtNum(decimalToPctDay(frr), 6) + "%/天 | 年化≈" + fmtNum(annualDecimalToPct(dayRateToAnnual(frr)), 2) + "%");
    debug("FRR ticker row=" + safeJson(raw));

    const target = calcTargetRate(frr);
    if (target.error) return fail(target.error);
    log("目标挂单: " + target.rateDesc);

    if (MIN_ANNUAL_RATE > 0 && target.annualRate < MIN_ANNUAL_RATE) {
      log("目标年化 " + fmtNum(annualDecimalToPct(target.annualRate), 2) + "% 低于门槛 " + fmtNum(annualDecimalToPct(MIN_ANNUAL_RATE), 2) + "%：跳过");
      return finishWithLog("跳过");
    }

    const currency = SYMBOL.replace(/^f/, "");
    const wallets = await authPost("/v2/auth/r/wallets", {});
    const bal = findFundingBalance(wallets, currency);
    if (!isFinite(bal)) return fail("未找到 funding 钱包余额: " + currency);

    try {
      const credits = await authPost("/v2/auth/r/funding/credits/" + SYMBOL, {});
      const creditSummary = summarizeCredits(credits);
      if (creditSummary.count > 0) {
        log("已成交订单: " + creditSummary.count + " 笔 | 总金额=" + fmtNum(creditSummary.totalAmount, 8));
        for (let i = 0; i < creditSummary.lines.length; i++) {
          log(creditSummary.lines[i]);
        }
      } else {
        log("已成交订单: 0 笔");
      }
    } catch (e) {
      log("已成交订单查询失败: " + (e && e.message ? e.message : String(e)));
    }

    const offers = await authPost("/v2/auth/r/funding/offers/" + SYMBOL, {});
    if (!Array.isArray(offers)) return fail("挂单返回异常: " + safeJson(offers).slice(0, 120));

    let locked = 0;
    for (let i = 0; i < offers.length; i++) {
      const amt = Math.abs(parseFloat(offers[i][4]));
      if (isFinite(amt)) locked += amt;
    }
    const totalAvail = bal + locked - RESERVE_AMOUNT;
    if (!isFinite(totalAvail)) return fail("可贷金额计算异常");

    log("钱包可用: " + fmtNum(bal, 2) + " | 已挂: " + fmtNum(locked, 2) + " | 预留: " + fmtNum(RESERVE_AMOUNT, 2) + " | 计划可贷: " + fmtNum(totalAvail, 2));

    const judgment = needsReorder(offers, target.offerType, target.offerRate, totalAvail);
    log((judgment.need ? "需要重挂" : "保持现状") + "：" + judgment.reason);
    if (!judgment.need) {
      return finishWithLog("保持现状");
    }

    const cancelCurrency = SYMBOL.replace(/^f/, "");
    try {
      await authPost("/v2/auth/w/funding/offer/cancel/all", { currency: cancelCurrency });
      log("已请求撤单，等待5秒后重算余额...");
      await $.wait(5000);
    } catch (e) {
      log("撤单警告: " + e.message);
    }

    await step4Submit(target);
    return;
  } catch (e) {
    fail(e && e.message ? e.message : String(e));
  }
}

main();

function Env(t, e) { class Http { constructor(env) { this.env = env; } send(opts, method = "GET") { opts = typeof opts === "string" ? { url: opts } : opts; const sender = method === "POST" ? this.post : this.get; return new Promise((resolve, reject) => { sender.call(this, opts, (err, resp, body) => err ? reject(err) : resolve({ resp, body })); }); } get(opts) { return this.env.get.call(this.env, opts); } post(opts) { return this.env.post.call(this.env, opts); } } return new class {
  constructor(name, opts) {
    this.name = name; this.http = new Http(this); this.data = null; this.dataFile = "box.dat";
    this.logs = []; this.logSeparator = "\n"; this.startTime = Date.now(); Object.assign(this, opts);
    this.log("", `🔔${this.name}, 开始!`);
  }
  isNode() { return typeof module !== "undefined" && !!module.exports; }
  isQuanX() { return typeof $task !== "undefined"; }
  isSurge() { return typeof $httpClient !== "undefined" && typeof $loon === "undefined"; }
  isLoon() { return typeof $loon !== "undefined"; }
  getdata(key) { return this.getval(key); }
  setdata(val, key) { return this.setval(val, key); }
  getval(key) { return this.isSurge() || this.isLoon() ? $persistentStore.read(key) : this.isQuanX() ? $prefs.valueForKey(key) : this.isNode() ? (this.data = this.loaddata(), this.data[key]) : null; }
  setval(val, key) { return this.isSurge() || this.isLoon() ? $persistentStore.write(val, key) : this.isQuanX() ? $prefs.setValueForKey(val, key) : this.isNode() ? (this.data = this.loaddata(), this.data[key] = val, this.writedata(), true) : false; }
  loaddata() { if (!this.isNode()) return {}; const fs = require("fs"), path = require("path"); const f1 = path.resolve(this.dataFile), f2 = path.resolve(process.cwd(), this.dataFile); const file = fs.existsSync(f1) ? f1 : (fs.existsSync(f2) ? f2 : null); if (!file) return {}; try { return JSON.parse(fs.readFileSync(file)); } catch { return {}; } }
  writedata() { if (!this.isNode()) return; const fs = require("fs"), path = require("path"); const f1 = path.resolve(this.dataFile); fs.writeFileSync(f1, JSON.stringify(this.data)); }
  get(opts, cb = () => {}) {
    if (opts.headers) { delete opts.headers["Content-Type"]; delete opts.headers["Content-Length"]; }
    if (this.isSurge() || this.isLoon()) {
      $httpClient.get(opts, (err, resp, body) => { if (!err && resp) { resp.body = body; resp.statusCode = resp.status; } cb(err, resp, body); });
    } else if (this.isQuanX()) {
      $task.fetch(opts).then(resp => cb(null, { status: resp.statusCode, statusCode: resp.statusCode, headers: resp.headers, body: resp.body }, resp.body), err => cb(err));
    } else if (this.isNode()) {
      const got = require("got"); got(opts).then(resp => cb(null, resp, resp.body), err => cb(err.message, err.response, err.response && err.response.body));
    }
  }
  post(opts, cb = () => {}) {
    if (opts.body && opts.headers && !opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (opts.headers) delete opts.headers["Content-Length"];
    if (this.isSurge() || this.isLoon()) {
      $httpClient.post(opts, (err, resp, body) => { if (!err && resp) { resp.body = body; resp.statusCode = resp.status; } cb(err, resp, body); });
    } else if (this.isQuanX()) {
      opts.method = "POST";
      $task.fetch(opts).then(resp => cb(null, { status: resp.statusCode, statusCode: resp.statusCode, headers: resp.headers, body: resp.body }, resp.body), err => cb(err));
    } else if (this.isNode()) {
      const got = require("got"); const { url, ...rest } = opts; got.post(url, rest).then(resp => cb(null, resp, resp.body), err => cb(err.message, err.response, err.response && err.response.body));
    }
  }
  msg(title = this.name, subt = "", desc = "") { if (this.isSurge() || this.isLoon()) $notification.post(title, subt, desc); else if (this.isQuanX()) $notify(title, subt, desc); this.logs.push("", "==============📣系统通知📣==============", title, subt, desc); }
  log(...args) { if (args.length) this.logs = [...this.logs, ...args]; console.log(args.join(this.logSeparator)); }
  wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  done(val = {}) { const cost = ((Date.now() - this.startTime) / 1000).toFixed(3); this.log("", `🔔${this.name}, 结束! 🕛 ${cost} 秒`); if (this.isSurge() || this.isQuanX() || this.isLoon()) $done(val); }
}(t, e); }

function hmacSha384Hex(key, msg) {
  try {
    if (typeof require !== "undefined") {
      const crypto = require("crypto");
      return crypto.createHmac("sha384", key).update(msg).digest("hex");
    }
  } catch (e) {}

  const keyB = utf8Bytes(key), msgB = utf8Bytes(msg), B = 128;
  let k = keyB;
  if (k.length > B) k = sha384(k);
  while (k.length < B) k.push(0);
  const ipad = [], opad = [];
  for (let i = 0; i < B; i++) {
    ipad.push(k[i] ^ 0x36);
    opad.push(k[i] ^ 0x5c);
  }
  const inner = sha384(ipad.concat(msgB));
  const outer = sha384(opad.concat(inner));
  return outer.map(b => ("0" + b.toString(16)).slice(-2)).join("");
}

function utf8Bytes(str) {
  const b = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) b.push(c);
    else if (c < 0x800) b.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return b;
}

function sha384(bytes) {
  const H = [
    [0xcbbb9d5d,0xc1059ed8],[0x629a292a,0x367cd507],[0x9159015a,0x3070dd17],[0x152fecd8,0xf70e5939],
    [0x67332667,0xffc00b31],[0x8eb44a87,0x68581511],[0xdb0c2e0d,0x64f98fa7],[0x47b5481d,0xbefa4fa4]
  ];
  const K = [
    [0x428a2f98,0xd728ae22],[0x71374491,0x23ef65cd],[0xb5c0fbcf,0xec4d3b2f],[0xe9b5dba5,0x8189dbbc],
    [0x3956c25b,0xf348b538],[0x59f111f1,0xb605d019],[0x923f82a4,0xaf194f9b],[0xab1c5ed5,0xda6d8118],
    [0xd807aa98,0xa3030242],[0x12835b01,0x45706fbe],[0x243185be,0x4ee4b28c],[0x550c7dc3,0xd5ffb4e2],
    [0x72be5d74,0xf27b896f],[0x80deb1fe,0x3b1696b1],[0x9bdc06a7,0x25c71235],[0xc19bf174,0xcf692694],
    [0xe49b69c1,0x9ef14ad2],[0xefbe4786,0x384f25e3],[0x0fc19dc6,0x8b8cd5b5],[0x240ca1cc,0x77ac9c65],
    [0x2de92c6f,0x592b0275],[0x4a7484aa,0x6ea6e483],[0x5cb0a9dc,0xbd41fbd4],[0x76f988da,0x831153b5],
    [0x983e5152,0xee66dfab],[0xa831c66d,0x2db43210],[0xb00327c8,0x98fb213f],[0xbf597fc7,0xbeef0ee4],
    [0xc6e00bf3,0x3da88fc2],[0xd5a79147,0x930aa725],[0x06ca6351,0xe003826f],[0x14292967,0x0a0e6e70],
    [0x27b70a85,0x46d22ffc],[0x2e1b2138,0x5c26c926],[0x4d2c6dfc,0x5ac42aed],[0x53380d13,0x9d95b3df],
    [0x650a7354,0x8baf63de],[0x766a0abb,0x3c77b2a8],[0x81c2c92e,0x47edaee6],[0x92722c85,0x1482353b],
    [0xa2bfe8a1,0x4cf10364],[0xa81a664b,0xbc423001],[0xc24b8b70,0xd0f89791],[0xc76c51a3,0x0654be30],
    [0xd192e819,0xd6ef5218],[0xd6990624,0x5565a910],[0xf40e3585,0x5771202a],[0x106aa070,0x32bbd1b8],
    [0x19a4c116,0xb8d2d0c8],[0x1e376c08,0x5141ab53],[0x2748774c,0xdf8eeb99],[0x34b0bcb5,0xe19b48a8],
    [0x391c0cb3,0xc5c95a63],[0x4ed8aa4a,0xe3418acb],[0x5b9cca4f,0x7763e373],[0x682e6ff3,0xd6b2b8a3],
    [0x748f82ee,0x5defb2fc],[0x78a5636f,0x43172f60],[0x84c87814,0xa1f0ab72],[0x8cc70208,0x1a6439ec],
    [0x90befffa,0x23631e28],[0xa4506ceb,0xde82bde9],[0xbef9a3f7,0xb2c67915],[0xc67178f2,0xe372532b],
    [0xca273ece,0xea26619c],[0xd186b8c7,0x21c0c207],[0xeada7dd6,0xcde0eb1e],[0xf57d4f7f,0xee6ed178],
    [0x06f067aa,0x72176fba],[0x0a637dc5,0xa2c898a6],[0x113f9804,0xbef90dae],[0x1b710b35,0x131c471b],
    [0x28db77f5,0x23047d84],[0x32caab7b,0x40c72493],[0x3c9ebe0a,0x15c9bebc],[0x431d67c4,0x9c100d4c],
    [0x4cc5d4be,0xcb3e42b6],[0x597f299c,0xfc657e2a],[0x5fcb6fab,0x3ad6faec],[0x6c44198c,0x4a475817]
  ];
  bytes = bytes.slice();
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 128) !== 112) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push((bitLen / Math.pow(2, i * 8)) & 0xff);

  function add(a, b) {
    const lo = (a[1] >>> 0) + (b[1] >>> 0);
    return [(a[0] + b[0] + (lo > 0xffffffff ? 1 : 0)) | 0, lo | 0];
  }
  function rotr(x, n) {
    return n < 32
      ? [(x[0] >>> n) | (x[1] << (32 - n)), (x[1] >>> n) | (x[0] << (32 - n))]
      : [(x[1] >>> (n - 32)) | (x[0] << (64 - n)), (x[0] >>> (n - 32)) | (x[1] << (64 - n))];
  }
  function shr(x, n) { return n < 32 ? [x[0] >>> n, (x[1] >>> n) | (x[0] << (32 - n))] : [0, x[0] >>> (n - 32)]; }
  function xor(a, b) { return [a[0] ^ b[0], a[1] ^ b[1]]; }
  function and(a, b) { return [a[0] & b[0], a[1] & b[1]]; }
  function not(a) { return [~a[0], ~a[1]]; }
  function S0(x) { return xor(xor(rotr(x, 28), rotr(x, 34)), rotr(x, 39)); }
  function S1(x) { return xor(xor(rotr(x, 14), rotr(x, 18)), rotr(x, 41)); }
  function s0(x) { return xor(xor(rotr(x, 1), rotr(x, 8)), shr(x, 7)); }
  function s1(x) { return xor(xor(rotr(x, 19), rotr(x, 61)), shr(x, 6)); }
  function Ch(e, f, g) { return xor(and(e, f), and(not(e), g)); }
  function Maj(a, b, c) { return xor(xor(and(a, b), and(a, c)), and(b, c)); }

  for (let off = 0; off < bytes.length; off += 128) {
    const W = [];
    for (let t = 0; t < 16; t++) {
      const idx = off + t * 8;
      W[t] = [
        (bytes[idx] << 24) | (bytes[idx + 1] << 16) | (bytes[idx + 2] << 8) | bytes[idx + 3],
        (bytes[idx + 4] << 24) | (bytes[idx + 5] << 16) | (bytes[idx + 6] << 8) | bytes[idx + 7]
      ];
    }
    for (let t = 16; t < 80; t++) W[t] = add(add(s1(W[t - 2]), W[t - 7]), add(s0(W[t - 15]), W[t - 16]));

    let a = H[0].slice(), b = H[1].slice(), c = H[2].slice(), d = H[3].slice();
    let e = H[4].slice(), f = H[5].slice(), g = H[6].slice(), h = H[7].slice();
    for (let t = 0; t < 80; t++) {
      const T1 = add(add(add(add(h, S1(e)), Ch(e, f, g)), K[t]), W[t]);
      const T2 = add(S0(a), Maj(a, b, c));
      h = g; g = f; f = e; e = add(d, T1); d = c; c = b; b = a; a = add(T1, T2);
    }
    H[0] = add(H[0], a); H[1] = add(H[1], b); H[2] = add(H[2], c); H[3] = add(H[3], d);
    H[4] = add(H[4], e); H[5] = add(H[5], f); H[6] = add(H[6], g); H[7] = add(H[7], h);
  }

  const out = [];
  for (let i = 0; i < 6; i++) {
    out.push(
      (H[i][0] >>> 24) & 0xff, (H[i][0] >>> 16) & 0xff, (H[i][0] >>> 8) & 0xff, H[i][0] & 0xff,
      (H[i][1] >>> 24) & 0xff, (H[i][1] >>> 16) & 0xff, (H[i][1] >>> 8) & 0xff, H[i][1] & 0xff
    );
  }
  return out;
}

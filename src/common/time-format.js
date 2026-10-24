/**
 * Sol Watch — time-format
 * 时间标准化与格式化纯函数（浏览器 / Node 双可用，无环境依赖）。
 * - normalizeTimestamp：把 create_time 归一到「秒」（毫秒/ISO 字符串/Date 兼容）；
 * - formatClockTime：时间标签（设备本地时区，12/24 小时制）；
 * - formatSentAt：SOL_TIME 元数据行使用的 sent_at（含秒与 UTC offset）；
 * - resolveIanaTimezone：浏览器 IANA 时区名。
 * 无可靠输入一律返回 null，绝不伪造。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchTimeFormat = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /**
   * 归一到 Unix 秒。
   * @param {*} input null/undefined/'' → null；秒数 → 原值；毫秒(≥1e12) → /1000；
   *                 数字字符串 → Number；ISO 字符串 → Date.parse/1000；Date → /1000；
   *                 0/负数/非法 → null。
   */
  function normalizeTimestamp(input) {
    if (input == null || input === '') return null;
    if (input instanceof Date) {
      if (isNaN(input.getTime())) return null;
      return Math.round(input.getTime() / 1000);
    }
    if (typeof input === 'number') {
      if (!isFinite(input) || input <= 0) return null;
      return input >= 1e12 ? Math.round(input / 1000) : Math.round(input);
    }
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) return null;
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        const ms = Date.parse(trimmed);
        if (isNaN(ms)) return null;
        return Math.round(ms / 1000);
      }
      if (/^\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (!isFinite(num) || num <= 0) return null;
        return num >= 1e12 ? Math.round(num / 1000) : Math.round(num);
      }
      return null;
    }
    return null;
  }

  const pad = (n) => String(n).padStart(2, '0');

  /** 时间标签：设备本地时区。24h: "MM/DD HH:mm:ss"；12h: "MM/DD h:mm:ss AM/PM" */
  function formatClockTime(ts, use24Hour) {
    const sec = Number(ts);
    if (!isFinite(sec) || sec <= 0) return ''; // 无可靠时间 → 空（不伪造）
    const date = new Date(sec * 1000);
    if (isNaN(date.getTime())) return '';
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    if (use24Hour !== false) {
      return `${mm}/${dd} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    }
    let h = date.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${mm}/${dd} ${h}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${ap}`;
  }

  /** UTC offset，如 +08:00 / -04:00。注意 getTimezoneOffset() 返回分钟且符号相反。 */
  function formatUtcOffset(date) {
    const offsetMin = -date.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const abs = Math.abs(offsetMin);
    return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  }

  /** sent_at：YYYY-MM-DDTHH:mm:ss±HH:MM（本地时间 + 本地 offset） */
  function formatSentAt(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${formatUtcOffset(date)}`;
  }

  /** IANA 时区名；取不到时返回空字符串 */
  function resolveIanaTimezone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch (_e) {
      return '';
    }
  }

  return { normalizeTimestamp, formatClockTime, formatSentAt, formatUtcOffset, resolveIanaTimezone };
});

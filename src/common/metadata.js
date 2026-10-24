/**
 * Sol Watch — metadata
 * 时间元数据行的构造 / 识别 / 注入 / 替换 / 防重复 / 剥离。
 * 纯函数，浏览器 / Node 双可用。
 *
 * 新格式（紧凑，仅保留时刻与 UTC offset）：
 *   ⟦t=2026-10-23T19:53:37+08:00⟧
 * 旧格式（继续识别，用于隐藏/剥离/编辑重发）：
 *   [SOL_TIME v=1 sent_at="2026-10-21T10:36:18+08:00" timezone="Asia/Shanghai"]
 */
(function (root, factory) {
  const api = factory(
    (typeof window !== 'undefined' && window.SolWatchTimeFormat) ||
    (typeof require === 'function' ? require('./time-format.js') : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchMetadata = api;
})(typeof window !== 'undefined' ? window : null, function (timeFormat) {
  'use strict';

  const LEGACY_BODY = String.raw`\[SOL_TIME v=1 sent_at="\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}" timezone="[^"]*"\]`;
  const COMPACT_BODY = String.raw`⟦t=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}⟧`;
  const LINE_BODY = `(?:${LEGACY_BODY}|${COMPACT_BODY})`;
  const LINE_PATTERN = new RegExp('^' + LINE_BODY + '$');
  const LINE_PREFIX_PATTERN = new RegExp('^' + LINE_BODY);
  const COMPACT_PATTERN = new RegExp('^' + COMPACT_BODY + '$');
  const LEGACY_PATTERN = new RegExp('^' + LEGACY_BODY + '$');

  /** 构造一行紧凑时间元数据（默认当前时间与本地 UTC offset）。 */
  function buildSolTimeLine(date) {
    // 用 toString 判断，兼容 iframe/jsdom 等跨 realm 的 Date
    const d = Object.prototype.toString.call(date) === '[object Date]' ? date : new Date();
    const sentAt = timeFormat && timeFormat.formatSentAt
      ? timeFormat.formatSentAt(d)
      : '';
    return `⟦t=${sentAt}⟧`;
  }

  /** 判断某一行是否为新版紧凑格式（允许首尾空白） */
  function isCompactSolTimeLine(line) {
    return typeof line === 'string' && COMPACT_PATTERN.test(line.trim());
  }

  /** 判断某一行是否为旧版 SOL_TIME 格式（允许首尾空白） */
  function isLegacySolTimeLine(line) {
    return typeof line === 'string' && LEGACY_PATTERN.test(line.trim());
  }

  /** 判断某一行是否为新版或旧版时间元数据（允许首尾空白） */
  function isSolTimeLine(line) {
    if (typeof line !== 'string') return false;
    return LINE_PATTERN.test(line.trim());
  }

  /** 匹配文本开头的元数据 token（不含正文）。新旧格式都识别。
   *  不能用贪婪的 `.*\]`：同一行正文里含 `]` 时会把正文一起吞掉。 */
  function matchSolTimePrefix(text) {
    if (typeof text !== 'string') return '';
    const m = text.match(LINE_PREFIX_PATTERN);
    return m ? m[0] : '';
  }

  /** 统计文本中合法元数据行数（新旧格式都计数，用于防重复注入） */
  function countSolTimeLines(text) {
    if (typeof text !== 'string') return 0;
    return text.split(/\r?\n/).filter(isSolTimeLine).length;
  }

  /**
   * 注入 / 替换：
   * - 空输入 → null（不注入空内容）；
   * - 首行已是合法时间元数据（旧版或新版）→ 仅替换该行（编辑/重发/retry
   *   更新为本次实际发送时间，并顺手把旧格式升级成紧凑格式）；
   * - 否则在正文最前插入 line + "\n" + original，原文逐字不变。
   *   只用一个换行：双换行在链接/图片消息里会多渲染出一个空段落。
   */
  function injectOrReplaceSolTime(original, line) {
    if (typeof original !== 'string' || !original.trim()) return null;
    const nl = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original.split(/\r?\n/);
    if (isSolTimeLine(lines[0])) {
      lines[0] = line;
      // 旧版注入用双换行；编辑/重发时顺手收成单换行（不碰正文自身的空行）
      if (lines.length > 1 && lines[1] === '') lines.splice(1, 1);
      return lines.join(nl);
    }
    return line + nl + original;
  }

  /** 只剥离文本绝对开头的一条元数据（新版或旧版）及其注入换行。
   *  正文中后续出现的同格式示例、引用或代码块保持原样。 */
  function stripLeadingSolTime(text) {
    if (typeof text !== 'string') return '';
    const prefix = matchSolTimePrefix(text);
    if (!prefix) return text;
    let rest = text.slice(prefix.length);
    // 去掉元数据行后的换行（允许行尾空格）；兼容旧版双换行注入
    rest = rest.replace(/^[ \t]*(?:\r\n|\n|\r)/, '');
    rest = rest.replace(/^(?:\r\n|\n|\r)/, '');
    return rest;
  }

  /** 兼容旧 API 名称：现在只剥离绝对开头的一条，不再删除正文里的示例。 */
  function stripSolTimeLines(text) {
    return stripLeadingSolTime(text);
  }

  return {
    buildSolTimeLine,
    isCompactSolTimeLine,
    isLegacySolTimeLine,
    isSolTimeLine,
    matchSolTimePrefix,
    countSolTimeLines,
    injectOrReplaceSolTime,
    stripLeadingSolTime,
    stripSolTimeLines
  };
});

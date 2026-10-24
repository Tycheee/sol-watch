/**
 * Sol Watch — session-anchor
 * 发送时间模式的状态机（纯内存，页面刷新即重置）。
 *
 * session 模式：
 * - 当前会话在本次页面生命周期内从未成功注入发送时间 → 注入；
 * - 距该会话上一次成功触发发送的注入已满 30 分钟 → 注入；
 * - 设备本地日期已经变化 → 注入；
 * - 编辑/重发/retry 且首行已有时间元数据 → 注入（替换旧时间）。
 * always 模式每条都注入；off 完全不注入。
 *
 * 状态按 conversation key 隔离；不存储正文，不做云同步。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchSessionAnchor = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const ANCHOR_INTERVAL_MS = 30 * 60 * 1000;
  const anchors = new Map();
  let nowFn = () => Date.now();

  const pad = (n) => String(n).padStart(2, '0');

  function currentTime() {
    let value;
    try { value = nowFn(); } catch (_e) { value = Date.now(); }
    if (value instanceof Date) value = value.getTime();
    return typeof value === 'number' && isFinite(value) ? value : Date.now();
  }

  function localDateKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function normalizeMode(mode) {
    return mode === 'always' || mode === 'off' ? mode : 'session';
  }

  /** 本次发送是否需要注入。hasExistingMetadata 表示编辑器首行已有旧/新元数据。 */
  function shouldInject(mode, conversationKey, hasExistingMetadata) {
    const m = normalizeMode(mode);
    if (m === 'off') return false;
    if (m === 'always') return true;
    if (hasExistingMetadata) return true;

    const key = conversationKey || '(unknown)';
    const anchor = anchors.get(key);
    if (!anchor) return true;

    const now = currentTime();
    if (localDateKey(now) !== anchor.dateKey) return true;
    return now - anchor.at >= ANCHOR_INTERVAL_MS;
  }

  /** 在发送动作成功触发后调用，记录该会话的锚点。 */
  function markInjected(conversationKey) {
    const now = currentTime();
    anchors.set(conversationKey || '(unknown)', {
      at: now,
      dateKey: localDateKey(now)
    });
  }

  function reset() {
    anchors.clear();
  }

  /** 仅测试使用：注入可控时钟；传 null 恢复 Date.now。 */
  function setNowForTests(fn) {
    nowFn = typeof fn === 'function' ? fn : () => Date.now();
  }

  return {
    ANCHOR_INTERVAL_MS,
    shouldInject,
    markInjected,
    reset,
    setNowForTests
  };
});

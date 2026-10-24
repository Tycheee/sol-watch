/**
 * Sol Watch — logger
 * 轻量日志：默认关闭（debug=false 时零输出），开启时输出到 console 并写入
 * 环形缓冲（供页面内/排错面板读取）。仅浏览器环境使用。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchLogger = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const PREFIX = '[SolWatch]';
  let enabled = false;
  const buffer = []; // 调试环形缓冲（仅 enabled 时写入），供页面内排错

  function log(level, args) {
    if (!enabled) return;
    const msg = args.map((a) => {
      try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (_e) { return String(a); }
    }).join(' ');
    buffer.push(`${level}: ${msg}`);
    if (buffer.length > 200) buffer.shift();
    const fn = (console && typeof console[level] === 'function') ? console[level] : console.log;
    try {
      fn.call(console, PREFIX, ...args);
    } catch (_e) { /* 忽略日志自身错误 */ }
  }

  return {
    setEnabled(v) { enabled = !!v; },
    isEnabled() { return enabled; },
    getBuffer() { return buffer.slice(); },
    debug(...args) { log('debug', args); },
    info(...args) { log('info', args); },
    warn(...args) { log('warn', args); },
    error(...args) { log('error', args); }
  };
});

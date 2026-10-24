/**
 * Sol Watch — ui-overlay
 * 时间标签的增删（低调、清晰，不影响复制正文）。标签仅为视觉层，不改消息数据。
 */
(function (root, factory) {
  const api = factory(
    (typeof window !== 'undefined' && window.SolWatchLogger) ||
    (typeof require === 'function' ? require('../common/logger.js') : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchUiOverlay = api;
})(typeof window !== 'undefined' ? window : null, function (logger) {
  'use strict';

  const log = logger || { debug() {}, warn() {}, error() {} };
  const LABEL_CLASS = 'solwatch-time-label';

  /** 给消息表面插入/更新一个时间标签（幂等：同文本不重复插入） */
  function addTimeLabel(surface, formatted) {
    if (!surface || !formatted) return null;
    let label = surface.querySelector('.' + LABEL_CLASS);
    if (label) {
      if (label.textContent === formatted) return label;
      label.textContent = formatted;
      return label;
    }
    label = document.createElement('span');
    label.className = LABEL_CLASS;
    label.textContent = formatted;
    surface.insertBefore(label, surface.firstChild);
    return label;
  }

  /** 移除 scope 内全部时间标签 */
  function removeAllTimeLabels(scope) {
    const root = scope || document;
    if (!root || !root.querySelectorAll) return 0;
    const labels = root.querySelectorAll('.' + LABEL_CLASS);
    let count = 0;
    for (const el of Array.from(labels)) {
      el.remove();
      count++;
    }
    return count;
  }

  return { addTimeLabel, removeAllTimeLabels, LABEL_CLASS };
});

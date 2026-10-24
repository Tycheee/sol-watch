/**
 * Sol Watch — ui-notice
 * 发送失败时的轻量本地提示：不遮挡输入框、不读正文、不写 console 代替 UI。
 * 只监听 `solwatch-send-failed`，4 秒后自动消失。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchNotice = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const NOTICE_CLASS = 'solwatch-notice';
  const DISMISS_MS = 4000;
  let el = null;
  let timer = null;

  function remove() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
  }

  function messageFor(reason) {
    return reason === 'send'
      ? 'Sol Watch 未能触发发送动作，草稿已恢复。'
      : 'Sol Watch 未能注入时间，消息未发送，草稿已恢复。';
  }

  function show(reason) {
    if (typeof document === 'undefined' || !document.body) return null;
    if (!el) {
      el = document.createElement('div');
      el.className = NOTICE_CLASS;
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      // 内联兜底：即使样式表未加载，也不能挡住输入框点击
      el.style.pointerEvents = 'none';
      document.body.appendChild(el);
    }
    el.textContent = messageFor(reason);
    if (timer) clearTimeout(timer);
    timer = setTimeout(remove, DISMISS_MS);
    return el;
  }

  function install() {
    if (typeof window === 'undefined') return false;
    if (window.__solWatchNoticeInstalled) return false;
    window.addEventListener('solwatch-send-failed', (event) => {
      show(event && event.detail && event.detail.reason);
    });
    window.__solWatchNoticeInstalled = true;
    return true;
  }

  if (typeof window !== 'undefined') install();

  return { NOTICE_CLASS, DISMISS_MS, show, remove, install };
});

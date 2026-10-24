/**
 * Sol Watch — settings-bridge（ISOLATED world）
 * MAIN world 的内容脚本没有 chrome.storage 扩展 API。本脚本运行在 ISOLATED world，
 * 负责：
 * - 启动时读取 chrome.storage.local 中的设置，postMessage 推给 MAIN world；
 * - 监听 storage.onChanged（popup 切换开关），实时推送；
 * - 响应 MAIN world 的请求（solwatch-request-settings）。
 * 不做任何 DOM 操作，不读聊天内容。
 */
(function () {
  'use strict';
  const KEY = 'solwatch.settings.v1';

  function pushSettings() {
    try {
      chrome.storage.local.get([KEY], (result) => {
        try {
          window.postMessage(
            { source: 'solwatch-bridge', type: 'solwatch-settings', settings: result && result[KEY] },
            '*'
          );
        } catch (_e) { /* ignore */ }
      });
    } catch (_e) { /* ignore */ }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data && e.data.source === 'solwatch-main' && e.data.type === 'solwatch-request-settings') {
      pushSettings();
    }
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes && changes[KEY]) pushSettings();
    });
  }

  pushSettings();
})();

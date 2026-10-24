/**
 * Sol Watch — popup 逻辑
 * 读取/写入设置（chrome.storage.local），与 content script 共用 settings.js。
 * storage 不可用时（预览等）回退默认值并只读展示。
 */
(function () {
  'use strict';
  const S = window.SolWatchSettings;
  if (!S) return;

  const $ = (id) => document.getElementById(id);
  const BOOL_KEYS = ['showUserTime', 'showAssistantTime', 'showSolTimeDebugLine', 'debug'];

  function bindToggle(id, key) {
    $(id).addEventListener('change', () => {
      S.setSettings({ [key]: $(id).checked });
    });
  }

  function render(settings) {
    for (const key of BOOL_KEYS) {
      const el = $(key === 'showUserTime' ? 'sw-user'
        : key === 'showAssistantTime' ? 'sw-assistant'
        : key === 'showSolTimeDebugLine' ? 'sw-debugLine' : 'sw-debug');
      if (el) el.checked = settings[key];
    }
    $('sw-send-mode').value = settings.sendTimeMode;
    if (settings.use24HourFormat) $('fmt-24').checked = true;
    else $('fmt-12').checked = true;
  }

  function init() {
    for (const key of BOOL_KEYS) {
      bindToggle(key === 'showUserTime' ? 'sw-user'
        : key === 'showAssistantTime' ? 'sw-assistant'
        : key === 'showSolTimeDebugLine' ? 'sw-debugLine' : 'sw-debug', key);
    }
    $('sw-send-mode').addEventListener('change', (e) => {
      S.setSettings({ sendTimeMode: e.target.value });
    });
    document.querySelectorAll('input[name="fmt"]').forEach((r) => {
      r.addEventListener('change', () => {
        S.setSettings({ use24HourFormat: r.value === '24' });
      });
    });
    $('btn-reset').addEventListener('click', () => {
      S.resetSettings().then(render);
    });
    S.getSettings().then(render);
  }

  document.addEventListener('DOMContentLoaded', init);
})();

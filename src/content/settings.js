/**
 * Sol Watch — settings
 * 设置存储（chrome.storage.local）+ 默认值 + 归一化。
 * 供 content script 与 popup 共同使用。
 *
 * 双 world 说明（Manifest V3）：
 * - MAIN world 的内容脚本（读 React fiber 需要）没有 chrome.storage 扩展 API；
 *   由 ISOLATED world 的 settings-bridge.js 负责读 storage 并 postMessage 推送给本模块。
 * - 本模块：有 chrome.storage 时直接读写（测试/popup/bridge 环境）；无 chrome.storage
 *   时（MAIN world）退化为监听 window message 同步的内存缓存。
 * 同步拦截（keydown/click capture）一律读 getCachedSettings()。
 */
(function (root, factory) {
  const api = factory(typeof chrome !== 'undefined' ? chrome : null);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchSettings = api;
})(typeof window !== 'undefined' ? window : null, function (chromeApi) {
  'use strict';

  const STORAGE_KEY = 'solwatch.settings.v1';
  const SEND_TIME_MODES = ['session', 'always', 'off'];

  const DEFAULTS = {
    showUserTime: true,          // 显示用户消息时间
    showAssistantTime: false,    // 同时显示 assistant 回复时间
    sendTimeMode: 'session',     // 发送时间：会话锚点 / 每条消息 / 关闭
    showSolTimeDebugLine: false, // 在消息正文中显示时间元数据调试行
    use24HourFormat: true,       // 24 小时制
    debug: false                 // 调试日志
  };

  function isSendTimeMode(value) {
    return SEND_TIME_MODES.includes(value);
  }

  /** 旧字段 tellModelSendTime → 新字段 sendTimeMode。
   *  新字段存在且合法时优先；否则 false→off、true/缺失→session。 */
  function resolveSendTimeMode(raw) {
    if (raw && isSendTimeMode(raw.sendTimeMode)) return raw.sendTimeMode;
    if (raw && raw.tellModelSendTime === false) return 'off';
    return 'session';
  }

  /** 写入时兼容旧调用方：只传 tellModelSendTime 的 patch 先翻译成 sendTimeMode。 */
  function migrateLegacyPatch(patch) {
    if (!patch || typeof patch !== 'object') return patch;
    if (isSendTimeMode(patch.sendTimeMode) || !('tellModelSendTime' in patch)) return patch;
    const { tellModelSendTime, ...rest } = patch;
    return Object.assign({}, rest, {
      sendTimeMode: tellModelSendTime === false ? 'off' : 'session'
    });
  }

  function normalizeSettings(raw) {
    const m = Object.assign({}, DEFAULTS, raw || {});
    return {
      showUserTime: m.showUserTime !== false,
      showAssistantTime: m.showAssistantTime === true,
      sendTimeMode: resolveSendTimeMode(raw),
      showSolTimeDebugLine: m.showSolTimeDebugLine === true,
      use24HourFormat: m.use24HourFormat !== false,
      debug: m.debug === true
    };
  }

  let cache = normalizeSettings();
  const hasStorage = !!(chromeApi && chromeApi.storage && chromeApi.storage.local);
  const listeners = new Set();

  /** 订阅设置变化（bridge 推送 / storage 变更 / 读取完成都会触发）。
   *  返回取消订阅函数。显示模块必须订阅，否则开关只更新缓存、UI 不生效。 */
  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function notify() {
    for (const listener of Array.from(listeners)) {
      try { listener(cache); } catch (_e) { /* 单个订阅者异常不影响其他 */ }
    }
  }

  function updateCache(raw) {
    const next = normalizeSettings(raw);
    const changed = JSON.stringify(next) !== JSON.stringify(cache);
    cache = next;
    if (changed) notify();
    return cache;
  }

  function getCachedSettings() {
    return cache;
  }

  function applyExternalSettings(next) {
    return updateCache(next);
  }

  // MAIN world：监听 ISOLATED bridge 推送的设置，并请求一次初始值
  if (!hasStorage && typeof window !== 'undefined') {
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const d = e.data;
      if (d && d.source === 'solwatch-bridge' && d.type === 'solwatch-settings') {
        updateCache(d.settings);
      }
    });
    try {
      window.postMessage({ source: 'solwatch-main', type: 'solwatch-request-settings' }, '*');
    } catch (_e) { /* ignore */ }
  }

  function storage() {
    if (!hasStorage) return null;
    return chromeApi.storage.local;
  }

  function getSettings() {
    const s = storage();
    if (!s) return Promise.resolve(cache);
    return new Promise((resolve) => {
      try {
        s.get([STORAGE_KEY], (result) => {
          const next = updateCache(result && result[STORAGE_KEY]);
          resolve(next);
        });
      } catch (_e) {
        resolve(normalizeSettings());
      }
    });
  }

  function setSettings(patch) {
    const s = storage();
    if (!s) return Promise.resolve(normalizeSettings());
    return getSettings().then((current) => {
      const normalizedPatch = migrateLegacyPatch(patch || {});
      const next = normalizeSettings(Object.assign({}, current, normalizedPatch));
      return new Promise((resolve) => {
        try {
          s.set({ [STORAGE_KEY]: next }, () => {
            updateCache(next);
            resolve(next);
          });
        } catch (_e) {
          resolve(next);
        }
      });
    });
  }

  function resetSettings() {
    const s = storage();
    if (!s) return Promise.resolve(normalizeSettings());
    return new Promise((resolve) => {
      try {
        s.remove(STORAGE_KEY, () => {
          const next = updateCache(undefined);
          resolve(next);
        });
      } catch (_e) {
        resolve(normalizeSettings());
      }
    });
  }

  if (hasStorage && chromeApi.storage.onChanged && typeof chromeApi.storage.onChanged.addListener === 'function') {
    try {
      chromeApi.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'local' && changes && changes[STORAGE_KEY]) {
          updateCache(changes[STORAGE_KEY].newValue);
        }
      });
    } catch (_e) { /* ignore */ }
    try { getSettings(); } catch (_e) { /* ignore */ }
  }

  return {
    STORAGE_KEY,
    SEND_TIME_MODES,
    DEFAULTS,
    normalizeSettings,
    getSettings,
    setSettings,
    resetSettings,
    getCachedSettings,
    applyExternalSettings,
    subscribe
  };
});

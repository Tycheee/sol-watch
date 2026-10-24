/**
 * Sol Watch — chrome stub（测试夹具用）
 * 提供最小 chrome.storage.local 内存实现 + onChanged 空实现，
 * 让 content script 在非扩展环境中可运行。
 */
(function () {
  'use strict';
  window.__solWatchStorage = {};
  window.chrome = {
    storage: {
      local: {
        get(keys, cb) {
          const out = {};
          for (const k of [].concat(keys)) {
            if (Object.prototype.hasOwnProperty.call(window.__solWatchStorage, k)) {
              out[k] = window.__solWatchStorage[k];
            }
          }
          if (cb) cb(out);
        },
        set(items, cb) {
          Object.assign(window.__solWatchStorage, items || {});
          if (cb) cb();
        },
        remove(keys, cb) {
          for (const k of [].concat(keys)) delete window.__solWatchStorage[k];
          if (cb) cb();
        }
      },
      onChanged: { addListener() {} }
    }
  };
})();

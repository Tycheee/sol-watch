/**
 * Sol Watch — main
 * 内容脚本编排：初始化各模块、观察 DOM（节流）、SPA 切换监听、周期兜底扫描、
 * 设置变更应用。显示侧读取失败 fail-open（不显示标签，不影响聊天）；
 * 发送侧注入/发送失败 fail-closed（恢复草稿，不发送无时间戳原文）。
 */
(function (root, factory) {
  const api = factory(
    (typeof window !== 'undefined' && window.SolWatchDomQueries) ||
    (typeof require === 'function' ? require('./dom-queries.js') : null),
    (typeof window !== 'undefined' && window.SolWatchTimeReader) ||
    (typeof require === 'function' ? require('./time-reader.js') : null),
    (typeof window !== 'undefined' && window.SolWatchUiOverlay) ||
    (typeof require === 'function' ? require('./ui-overlay.js') : null),
    (typeof window !== 'undefined' && window.SolWatchMetadataHider) ||
    (typeof require === 'function' ? require('./metadata-hider.js') : null),
    (typeof window !== 'undefined' && window.SolWatchSenderHook) ||
    (typeof require === 'function' ? require('./sender-hook.js') : null),
    (typeof window !== 'undefined' && window.SolWatchSettings) ||
    (typeof require === 'function' ? require('./settings.js') : null),
    (typeof window !== 'undefined' && window.SolWatchTimeFormat) ||
    (typeof require === 'function' ? require('../common/time-format.js') : null),
    (typeof window !== 'undefined' && window.SolWatchLogger) ||
    (typeof require === 'function' ? require('../common/logger.js') : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchMain = api;
})(typeof window !== 'undefined' ? window : null, function (dom, timeReader, overlay, hider, senderHook, settingsApi, timeFormat, logger) {
  'use strict';

  const log = logger || { debug() {}, warn() {}, error() {} };
  const SCAN_INTERVAL_MS = 30000;
  const OBSERVER_THROTTLE_MS = 250;

  let settings = settingsApi.normalizeSettings();
  let scanTimer = null;
  let scanScheduled = false;
  let scanRunning = false;
  let observer = null;
  let senderHandle = null;

  /** 对单个候选（turn）按角色处理：元数据行隐藏/调试显示 → 读时间 → 标签。
   *  隐藏与 create_time 解耦：即使时间读取暂时失败，也不能让时间元数据露出来。 */
  function processSurface(candidate, role) {
    const wantUser = settings.showUserTime && role === 'user';
    const wantAssistant = settings.showAssistantTime && role === 'assistant';
    const surface = role === 'user' ? dom.getUserBubble(candidate) : dom.getAssistantBubble(candidate);
    if (!surface) return;

    // 用户消息的时间元数据调试行/隐藏逻辑（必须先于任何提前 return）
    if (role === 'user') {
      hider.applyToContainer(surface, settings.showSolTimeDebugLine);
    }

    const ts = timeReader.readCreateTime(candidate, role);
    if (ts == null) {
      // 无可靠 create_time：不显示标签（不伪造）
      const existing = surface.querySelector('.solwatch-time-label');
      if (existing) existing.remove();
      return;
    }
    if (wantUser || wantAssistant) {
      overlay.addTimeLabel(surface, timeFormat.formatClockTime(ts, settings.use24HourFormat));
    }
  }

  /** 全量扫描（幂等）。带同步死循环防护（scanMs > 600ms 即中断并告警）。 */
  function scan() {
    if (scanRunning) return;
    scanRunning = true;
    const started = Date.now();
    try {
      const candidates = dom.getMessageCandidates();
      log.debug('scan:start', { n: candidates.length });
      for (const candidate of candidates) {
        if (Date.now() - started > 600) {
          log.error('scan aborted: 超过 600ms，疑似死循环');
          break;
        }
        // 一个 turn 可能同时含 user 与 assistant surface（同轮消息），分别处理
        const userSurface = dom.getUserBubble(candidate);
        const assistantSurface = dom.getAssistantBubble(candidate);
        if (userSurface) processSurface(candidate, 'user');
        if (assistantSurface) processSurface(candidate, 'assistant');
        // 旧 shell：turn 本身带 role 属性时兜底处理
        if (!userSurface && !assistantSurface) {
          const role = dom.getDomRole(candidate) || timeReader.readRoleFromFiber(candidate);
          if (role) processSurface(candidate, role);
        }
      }
      log.debug('scan:end', { ms: Date.now() - started });
    } catch (err) {
      log.warn('scan failed', err);
    } finally {
      scanRunning = false;
    }
  }

  function scheduleScan(delay) {
    if (scanScheduled) return;
    scanScheduled = true;
    scanTimer = setTimeout(() => {
      scanScheduled = false;
      scan();
    }, delay == null ? OBSERVER_THROTTLE_MS : delay);
  }

  function containsMessageCandidate(addedNodes) {
    for (const node of addedNodes) {
      if (!node || node.nodeType !== 1) continue;
      if (node.matches && node.matches(dom.MESSAGE_CANDIDATE_SELECTOR)) return true;
      if (node.querySelector && node.querySelector(dom.MESSAGE_CANDIDATE_SELECTOR)) return true;
    }
    return false;
  }

  function startObserver() {
    if (observer || typeof MutationObserver === 'undefined') return;
    observer = new MutationObserver((mutations) => {
      let relevant = false;
      for (const m of mutations) {
        if (m.type === 'childList' && containsMessageCandidate(m.addedNodes)) { relevant = true; break; }
      }
      if (relevant) scheduleScan(OBSERVER_THROTTLE_MS);
    });
    try {
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (_e) { /* ignore */ }
  }

  function patchSpaNavigation() {
    try {
      const history = window.history;
      const wrap = (name) => {
        const original = history[name];
        if (typeof original !== 'function') return;
        history[name] = function (...args) {
          const result = original.apply(this, args);
          scheduleScan(400);
          return result;
        };
      };
      wrap('pushState');
      wrap('replaceState');
      window.addEventListener('popstate', () => scheduleScan(400));
      window.addEventListener('hashchange', () => scheduleScan(400));
    } catch (_e) { /* ignore */ }
  }

  function startPeriodicRescan() {
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = setInterval(() => scan(), SCAN_INTERVAL_MS);
  }

  function startStorageWatch() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[settingsApi.STORAGE_KEY]) return;
      settingsApi.getSettings().then(applySettings);
    });
  }

  /** 应用设置：日志开关 + 重新扫描（标签增删、调试行显隐） */
  function applySettings(next) {
    settings = settingsApi.normalizeSettings(next);
    // 注意：不要在这里回写 settingsApi.applyExternalSettings —— settings 模块
    // 是缓存的事实来源，回写会再次触发订阅，形成循环。
    logger.setEnabled(settings.debug);
    log.debug('applySettings', settings);
    overlay.removeAllTimeLabels();
    scan();
  }

  function init() {
    if (window.__solWatchMainInitialized) {
      return { senderInstalled: !!(senderHandle && senderHandle.installed), already: true };
    }
    senderHandle = senderHook.init();
    hider.installCopyStrip();
    startObserver();
    patchSpaNavigation();
    startPeriodicRescan();
    startStorageWatch();
    // R4: 订阅设置变化（bridge 推送/storage 变更），显示模块必须跟着应用；
    // 首次读取完成也走同一入口。
    if (typeof settingsApi.subscribe === 'function') {
      settingsApi.subscribe(applySettings);
    }
    settingsApi.getSettings().then(applySettings);
    window.__solWatchMainInitialized = true;
    return { senderInstalled: !!(senderHandle && senderHandle.installed) };
  }

  // ISOLATED world 下内容脚本自动初始化；测试/夹具环境由页面手动调用
  if (typeof window !== 'undefined' && typeof chrome !== 'undefined') {
    window.setTimeout(() => {
      try { init(); } catch (err) { log.error('SolWatch init failed', err); }
    }, 0);
  }

  return { init, scan, processSurface, applySettings };
});

/**
 * Sol Watch — dom-queries
 * 全部 DOM 查询收敛于此：消息候选、角色语义表面、composer / 提交按钮、会话 id。
 * 不依赖单一 class name，优先稳定语义属性，并保留多 shell 兼容路径。
 * ChatGPT 前端改版时，最可能只需要修本文件。
 */
(function (root, factory) {
  const api = factory(
    (typeof window !== 'undefined' && window.SolWatchLogger) ||
    (typeof require === 'function' ? require('../common/logger.js') : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchDomQueries = api;
})(typeof window !== 'undefined' ? window : null, function (logger) {
  'use strict';

  const log = logger || { debug() {}, warn() {}, error() {} };

  /** 消息候选：覆盖新版 turn 元素与旧版 section/message div */
  const MESSAGE_CANDIDATE_SELECTOR = [
    '[data-turn-key]',
    'section[data-turn-id]',
    'div[data-message-id]',
    '[data-user-message-bubble]',
    '[data-markdown-text-style="assistant-message"]'
  ].join(', ');

  /** 用户消息语义表面（新版 shell 位于 turn 内层） */
  const USER_BUBBLE_SELECTOR = '[data-user-message-bubble]';
  /** assistant 语义表面 */
  const ASSISTANT_BUBBLE_SELECTOR = '[data-markdown-text-style="assistant-message"]';
  /** 旧 shell 角色属性 */
  const ROLE_ATTR_SELECTOR = '[data-message-author-role]';

  /** 编辑器：textarea / contenteditable（ProseMirror）/ role=textbox。
   *  注意不要把 `form` 放进选择器：closest('form') 会把事件目标错误解析成
   *  <form> 元素本身，导致后续 textContent 读取为空、Enter 路径被提前 return。 */
  const COMPOSER_SELECTOR = 'textarea, [contenteditable="true"], div[role="textbox"]';

  /** 提交按钮：data-testid / aria-label（中英）/ type=submit */
  const SUBMIT_BUTTON_SELECTOR = [
    'button[data-testid*="send" i]',
    'button[aria-label*="发送" i]',
    'button[aria-label*="send" i]',
    'button[type="submit"]'
  ].join(', ');

  function matchesOrSelf(el, selector) {
    if (!el || !el.matches) return null;
    return el.matches(selector) ? el : el.closest(selector);
  }

  /** 消息候选列表（文档顺序，外层 turn 去重：若候选是另一个候选的后代，跳过外层） */
  function getMessageCandidates(rootEl) {
    const scope = rootEl || (typeof document !== 'undefined' ? document : null);
    if (!scope) return [];
    const nodes = Array.from(scope.querySelectorAll(MESSAGE_CANDIDATE_SELECTOR));
    const result = [];
    for (const node of nodes) {
      const isNested = nodes.some((other) => other !== node && other.contains(node));
      if (isNested) continue; // 只保留最外层候选（turn 级），内层 bubble 由 surface 查询负责
      result.push(node);
    }
    return result;
  }

  function getUserBubble(candidate) {
    if (!candidate) return null;
    // 新版 shell：语义 bubble 是 turn 的后代；旧版则候选自身即 bubble
    if (candidate.querySelector) {
      const inner = candidate.querySelector(USER_BUBBLE_SELECTOR);
      if (inner) return inner;
    }
    return matchesOrSelf(candidate, USER_BUBBLE_SELECTOR);
  }

  function getAssistantBubble(candidate) {
    if (!candidate) return null;
    if (candidate.querySelector) {
      const inner = candidate.querySelector(ASSISTANT_BUBBLE_SELECTOR);
      if (inner) return inner;
    }
    return matchesOrSelf(candidate, ASSISTANT_BUBBLE_SELECTOR);
  }

  /** 从 DOM 属性判断角色（旧 shell：data-message-author-role） */
  function getDomRole(candidate) {
    const holder = matchesOrSelf(candidate, ROLE_ATTR_SELECTOR);
    if (holder) {
      const role = holder.getAttribute('data-message-author-role');
      if (role === 'user' || role === 'assistant') return role;
    }
    return null;
  }

  /** 会话 id：优先 URL /c/<id>，其次 DOM 属性 */
  function getConversationId() {
    try {
      if (typeof window !== 'undefined' && window.location) {
        const m = window.location.pathname.match(/\/c\/([0-9a-fA-F-]+)/);
        if (m) return m[1];
      }
    } catch (_e) { /* ignore */ }
    if (typeof document !== 'undefined') {
      const el = document.querySelector('[data-conversation-id]');
      if (el) {
        const id = el.getAttribute('data-conversation-id');
        if (id) return id;
      }
    }
    return null;
  }

  /** 点击目标是否为提交按钮（沿 closest 找） */
  function getSubmitButtonFromEventTarget(target) {
    if (!target || !target.closest) return null;
    return target.closest(SUBMIT_BUTTON_SELECTOR);
  }

  /** 从事件目标找编辑器 */
  function getComposerFromNode(node) {
    if (!node || !node.closest) return null;
    return node.closest(COMPOSER_SELECTOR);
  }

  /** 元素是否真的可见/可交互（隐藏的空 textarea 不能抢走注入）。 */
  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hidden) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    const inline = (el.getAttribute && el.getAttribute('style')) || '';
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(inline)) return false;
    try {
      if (typeof el.checkVisibility === 'function' &&
          !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
        return false;
      }
    } catch (_e) { /* checkVisibility 参数不被支持时退回下面的判断 */ }
    try {
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        const cs = window.getComputedStyle(el);
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
      }
    } catch (_e) { /* ignore */ }
    // 有布局的环境：offsetParent / client rects 能识别 display:none / 折叠容器。
    // jsdom 无布局，两者恒为空，不能据此判负。
    try {
      if (el.offsetParent !== null) return true;
      if (el.getClientRects && el.getClientRects().length > 0) return true;
    } catch (_e) { /* ignore */ }
    return true;
  }

  function composerText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return (el.isContentEditable === true ||
      (el.getAttribute && ['', 'true', 'plaintext-only'].includes(el.getAttribute('contenteditable'))))
      ? (el.textContent || '') : '';
  }

  /** 给候选编辑器打分：可见、聚焦、非空、contenteditable 优先。 */
  function composerScore(el, activeEl) {
    if (!isElementVisible(el)) return -1000;
    let score = 0;
    if (activeEl && (activeEl === el || (el.contains && el.contains(activeEl)))) score += 20;
    if (el.isContentEditable === true ||
        (el.getAttribute && ['', 'true', 'plaintext-only'].includes(el.getAttribute('contenteditable')))) {
      score += 6;
    }
    if (el.tagName === 'TEXTAREA') score += 3;
    if (composerText(el).trim()) score += 10;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') score -= 100;
    return score;
  }

  /** 从一组候选里选真正可用的编辑器（跳过隐藏的空元素）。 */
  function pickBestComposer(nodes, activeEl) {
    let best = null;
    let bestScore = -Infinity;
    for (const el of nodes) {
      if (!el || !el.matches || !el.matches(COMPOSER_SELECTOR)) continue;
      const score = composerScore(el, activeEl || (typeof document !== 'undefined' ? document.activeElement : null));
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return bestScore > -1000 ? best : null;
  }

  /** 从提交按钮找编辑器（同一 form 内优先；跳过隐藏空 textarea）。 */
  function getComposerFromButton(button) {
    if (!button) return null;
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const form = button.closest && button.closest('form');
    const nodes = [];
    if (form) nodes.push(...form.querySelectorAll(COMPOSER_SELECTOR));
    const around = button.closest ? button.closest(COMPOSER_SELECTOR) : null;
    if (around) nodes.push(around);
    const best = pickBestComposer(nodes, active);
    if (best) return best;
    // 按钮不在 form 内/没有候选：退到按钮附近容器，再退到全局可见编辑器
    const container = button.parentElement && button.parentElement.closest
      ? button.parentElement.closest('form, [data-testid*="composer" i], main')
      : null;
    if (container) {
      const scoped = pickBestComposer(container.querySelectorAll(COMPOSER_SELECTOR), active);
      if (scoped) return scoped;
    }
    return getActiveComposer();
  }

  /** 当前活跃编辑器：优先聚焦/可见/非空，而不是 querySelector 的第一个。 */
  function getActiveComposer() {
    if (typeof document === 'undefined') return null;
    const nodes = Array.from(document.querySelectorAll(COMPOSER_SELECTOR));
    const active = document.activeElement;
    if (active && active.matches && active.matches(COMPOSER_SELECTOR) &&
        isElementVisible(active)) {
      return active;
    }
    return pickBestComposer(nodes, active);
  }

  return {
    MESSAGE_CANDIDATE_SELECTOR,
    USER_BUBBLE_SELECTOR,
    ASSISTANT_BUBBLE_SELECTOR,
    COMPOSER_SELECTOR,
    SUBMIT_BUTTON_SELECTOR,
    getMessageCandidates,
    getUserBubble,
    getAssistantBubble,
    getDomRole,
    getConversationId,
    getSubmitButtonFromEventTarget,
    getComposerFromNode,
    getComposerFromButton,
    getActiveComposer,
    isElementVisible,
    pickBestComposer
  };
});

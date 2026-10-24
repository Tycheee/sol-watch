/**
 * Sol Watch — sender-hook
 * 发送拦截（仅网页版）：在发送动作真正触发前，把紧凑时间元数据 ⟦t=…⟧ 注入正文最前，
 * 然后恢复发送。设计要点（参考 chatgpt-codex-temporal-awareness-extension 的公开
 * 设计思路，未复制其代码，该仓库无 LICENSE）：
 * - window capture 阶段监听 Enter / 点击发送（必须早于页面自己的 document
 *   capture keydown/submit handler）；
 * - contenteditable / ProseMirror 编辑器：用 Selection + execCommand('insertText')
 *   插入文本，这会触发原生 beforeinput/input 流，ProseMirror/React 内部 state
 *   才会同步；直接改 textContent 会拍平 DOM 且 state 不更新（实测是旧版 bug）；
 * - textarea：用 native value setter + dispatch input，绕过 React 受控缓存；
 * - Shift+Enter、IME 组合、空内容直接放行；
 * - pendingSend 防并发，resumeSend 防递归；
 * - 注入结果必须验证（execCommand 返回值 + 时间戳/正文都在）；验证失败时恢复
 *   草稿并取消本次发送，绝不发送没有时间戳的原文；
 * - 无法触发发送动作（按钮消失/禁用、form 不可提交）同样恢复草稿并派发
 *   `solwatch-send-failed`，不静默把消息留在输入框里；
 * - 触发发送动作 ≠ 网络发送成功；扩展无法确认服务端是否接收；
 * - 首块已是旧版/新版时间元数据时仅替换（编辑/重发/retry 覆盖），
 *   同一条消息不会出现多行；
 * - sendTimeMode=session 时按会话锚点判断：不需要注入就完全放行原生发送。
 *   always 每条注入；off 完全不注入。
 */
(function (root, factory) {
  const api = factory(
    (typeof window !== 'undefined' && window.SolWatchDomQueries) ||
    (typeof require === 'function' ? require('./dom-queries.js') : null),
    (typeof window !== 'undefined' && window.SolWatchMetadata) ||
    (typeof require === 'function' ? require('../common/metadata.js') : null),
    (typeof window !== 'undefined' && window.SolWatchTimeFormat) ||
    (typeof require === 'function' ? require('../common/time-format.js') : null),
    (typeof window !== 'undefined' && window.SolWatchSettings) ||
    (typeof require === 'function' ? require('./settings.js') : null),
    (typeof window !== 'undefined' && window.SolWatchSessionAnchor) ||
    (typeof require === 'function' ? require('./session-anchor.js') : null),
    (typeof window !== 'undefined' && window.SolWatchLogger) ||
    (typeof require === 'function' ? require('../common/logger.js') : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchSenderHook = api;
})(typeof window !== 'undefined' ? window : null, function (dom, metadata, timeFormat, settingsApi, sessionAnchor, logger) {
  'use strict';

  const log = logger || { debug() {}, warn() {}, error() {} };
  let enabled = true;
  let pendingSend = false;
  let resumeSend = false;
  let lastActiveComposer = null;

  function isTextLikeInput(composer) {
    return composer && (composer.tagName === 'TEXTAREA' || composer.tagName === 'INPUT');
  }

  /** contenteditable 判定：浏览器用 isContentEditable，测试环境(jsdom)退回属性。 */
  function isEditable(composer) {
    if (!composer) return false;
    if (composer.isContentEditable === true) return true;
    const attr = composer.getAttribute && composer.getAttribute('contenteditable');
    if (attr != null) return attr === '' || attr === 'true' || attr === 'plaintext-only';
    return !!(composer.closest && composer.closest('[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"]'));
  }

  function getComposerText(composer) {
    if (!composer) return '';
    if (isTextLikeInput(composer)) return composer.value || '';
    if (isEditable(composer)) return composer.textContent || '';
    return '';
  }

  /** 会话 key：优先 conversation ID，取不到时退回稳定的 pathname。 */
  function conversationKey() {
    const id = dom.getConversationId();
    if (id) return 'id:' + id;
    try {
      return 'path:' + ((typeof window !== 'undefined' && window.location && window.location.pathname) || '');
    } catch (_e) {
      return 'path:';
    }
  }

  /** 编辑器绝对开头是否已有旧版或新版时间元数据（编辑/重发/retry 时必须更新时间）。
   *  用 token 前缀而不是 split 首行，兼容 <br>/块级拆分且正文紧跟 token 的结构。 */
  function startsWithMetadata(text) {
    return !!metadata.matchSolTimePrefix(String(text || ''));
  }

  /** 按当前 sendTimeMode 判断是否需要拦截注入；false 时必须完全放行原生发送。 */
  function shouldInjectForComposer(composer) {
    const mode = settingsApi.getCachedSettings().sendTimeMode || 'session';
    return sessionAnchor.shouldInject(mode, conversationKey(), startsWithMetadata(getComposerText(composer)));
  }

  /** 在 contenteditable（ProseMirror）里插入/替换时间元数据首行。
   *  用 Selection + execCommand insertText：触发原生 beforeinput/input，PM state 同步。
   *  编辑重发场景：旧/新元数据可能与正文同处一个首块（或整个编辑器只有一个文本节点），
   *  按“首行范围”替换而非整块，避免重复注入第二行。 */
  function injectIntoContentEditable(composer, solLine, originalText) {
    composer.focus();
    // 真实 ChatGPT 首块是 <p>；测试/某些 shell 可能直接是纯文本节点
    const block = composer.firstElementChild || composer;
    const blockText = block.textContent || '';
    const prefix = metadata.matchSolTimePrefix(blockText);
    let range = document.createRange();
    let needsNewline = true;
    if (prefix) {
      // 替换 token 本体（块起点 → token 末尾），保留其后的换行、<br> 和正文
      range.selectNodeContents(block);
      let remaining = prefix.length;
      let endNode = block; let endOffset = 0;
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      let tn;
      while ((tn = walker.nextNode())) {
        if (remaining <= tn.length) { endNode = tn; endOffset = remaining; break; }
        remaining -= tn.length;
      }
      try { range.setEnd(endNode, endOffset); } catch (_e) { /* ignore */ }
      needsNewline = false;
    } else {
      range.selectNodeContents(composer);
      range.collapse(true);
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // 单换行：元数据仍独占一行，但不会在链接/图片消息里多渲染出空段落。
    // 旧消息里的双换行由 hider 兼容清理。
    const ok = document.execCommand('insertText', false, solLine + (needsNewline ? '\n' : ''));
    if (!ok) return false;
    // 验证：时间戳确实进入正文，且原正文没有被吞掉
    const nowText = composer.textContent || '';
    if (nowText.indexOf(solLine) < 0) return false;
    const body = metadata.stripLeadingSolTime(originalText || '').trim();
    if (body) {
      const norm = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      if (!norm(nowText).includes(norm(body))) return false;
    }
    return true;
  }

  /** 在 textarea 里注入：native setter + input 事件（React 受控正确同步） */
  function injectIntoTextArea(composer, solLine) {
    const proto = composer.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    const current = composer.value || '';
    const updated = metadata.injectOrReplaceSolTime(current, solLine);
    if (updated == null) return false;
    setter.call(composer, updated);
    composer.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
    return composer.value === updated && composer.value.indexOf(solLine) >= 0;
  }

  /** 注入时间元数据到编辑器。返回是否**验证通过**（false 时调用方不得发送）。 */
  function injectIntoComposer(composer, solLine) {
    try {
      const original = getComposerText(composer);
      if (!original.trim()) return false;
      if (isTextLikeInput(composer)) return injectIntoTextArea(composer, solLine);
      if (isEditable(composer)) {
        return injectIntoContentEditable(composer, solLine, original);
      }
      return false;
    } catch (err) {
      log.warn('injectIntoComposer failed', err);
      return false;
    }
  }

  /** 失败恢复：把编辑器内容还原为注入前，避免留下半截元数据。 */
  function restoreComposer(composer, original) {
    try {
      if (isTextLikeInput(composer)) {
        const proto = composer.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(composer, original);
        composer.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
        return true;
      }
      if (isEditable(composer)) {
        composer.focus();
        const range = document.createRange();
        range.selectNodeContents(composer);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        return document.execCommand('insertText', false, original);
      }
    } catch (err) {
      log.warn('restoreComposer failed', err);
    }
    return false;
  }

  function notifySendFailure(reason) {
    try {
      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('solwatch-send-failed', { detail: { reason } }));
      }
    } catch (_e) { /* ignore */ }
  }

  function waitForComposerCommit() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      const timer = setTimeout(finish, 150);
      try {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => { clearTimeout(timer); finish(); }));
      } catch (_e) {
        clearTimeout(timer);
        finish();
      }
    });
  }

  function rememberComposer(node) {
    const composer = node && (node.closest ? node.closest(dom.COMPOSER_SELECTOR) : null);
    if (composer) lastActiveComposer = composer;
  }

  /** 在编辑器周边找发送按钮（aria-label 中英、data-testid、type=submit）。
   *  只返回当前可见且未禁用的按钮；preferred 失效时继续搜索。 */
  function findSendButton(composer, preferred) {
    const usable = (btn) => btn && !btn.disabled && dom.isElementVisible(btn);
    if (usable(preferred)) return preferred;
    try {
      const root = (composer && composer.closest && composer.closest('form')) || document;
      for (const btn of root.querySelectorAll(dom.SUBMIT_BUTTON_SELECTOR)) {
        if (usable(btn)) return btn;
      }
      for (const btn of document.querySelectorAll(dom.SUBMIT_BUTTON_SELECTOR)) {
        if (usable(btn)) return btn;
      }
      return null;
    } catch (_e) {
      return null;
    }
  }

  /** 触发发送：优先点发送按钮（等它从 disabled 变 enabled），fallback form.requestSubmit。
   *  返回是否真的把发送动作发出去了（不代表网络请求成功）。 */
  async function triggerSend(composer, preferredButton) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const btn = findSendButton(composer, preferredButton);
      if (btn) {
        resumeSend = true;
        btn.click();
        // click() 同步派发：拦截器若吞掉这次点击会当场把 resumeSend 复位；
        // 走到这里仍为 true，说明事件没有到达我们的 window capture 监听器
        // （按钮已被移出文档，或被页面更早注册的 capture handler 吞掉）。
        // 必须在这里同步复位，不能把状态留给下一次真实用户操作。
        if (resumeSend) resumeSend = false;
        return true;
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    // fallback：form 提交。requestSubmit 不经过 click 拦截，不需要 resumeSend；
    // 若在这里置 true 而不复位，下一次 Enter/点击会被直接放行，可能发出未注入的原文。
    try {
      const form = composer && composer.closest && composer.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
        return true;
      }
    } catch (_e) { /* ignore */ }
    return false;
  }

  /** 执行注入 + 发送。返回 true 仅当注入验证通过且发送动作已触发。 */
  async function handleSend(composer, button, via) {
    const original = getComposerText(composer);
    const sessionKey = conversationKey();
    try {
      const solLine = metadata.buildSolTimeLine();
      if (!metadata.isCompactSolTimeLine(solLine)) {
        log.error('时间元数据构造失败，取消发送');
        restoreComposer(composer, original);
        notifySendFailure('inject');
        return false;
      }
      const ok = injectIntoComposer(composer, solLine);
      log.debug('injected', { ok, via });
      if (!ok) {
        // 注入失败：恢复原文，不发没有时间戳的消息
        log.error('注入验证失败，取消发送并恢复草稿', { via });
        restoreComposer(composer, original);
        notifySendFailure('inject');
        return false;
      }
      await waitForComposerCommit();
      const sent = await triggerSend(composer, button);
      if (!sent) {
        // 无法触发发送动作：恢复原文，避免留下隐藏元数据/吞键后无法重试
        log.error('发送动作未触发，恢复草稿', { via });
        restoreComposer(composer, original);
        notifySendFailure('send');
        return false;
      }
      // 只记录“发送动作已成功触发”，不代表网络请求成功或服务端已接收。
      // 新会话发送后 URL 可能从 pathname fallback 变成 /c/<id>；仅在这种情况下
      // 同时记录新 key，避免下一条因为 key 变化被误判成“首次发送”再次注入。
      sessionAnchor.markInjected(sessionKey);
      const settledKey = conversationKey();
      if (settledKey !== sessionKey &&
          /^path:/.test(sessionKey) && /^id:/.test(settledKey)) {
        sessionAnchor.markInjected(settledKey);
      }
      return true;
    } catch (err) {
      log.error('handleSend 异常，恢复草稿', err);
      restoreComposer(composer, original);
      notifySendFailure('exception');
      return false;
    }
  }

  function onClick(e) {
    if (!enabled) return;
    if (resumeSend) { resumeSend = false; return; }
    const button = dom.getSubmitButtonFromEventTarget(e.target);
    if (!button || pendingSend) return;

    const composer = dom.getComposerFromButton(button);
    if (!composer || !getComposerText(composer)) return;
    // session 模式不需要注入时完全放行原生发送，不拦截再模拟
    if (!shouldInjectForComposer(composer)) return;

    log.debug('intercept click');
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    pendingSend = true;
    handleSend(composer, button, 'click').finally(() => { pendingSend = false; });
  }

  function onKeyDown(e) {
    if (!enabled) return;
    if (resumeSend) { resumeSend = false; return; }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;

    // 严格限定：事件目标必须位于编辑器内部（不回退到全局/上次编辑器，
    // 避免在侧边栏按钮等处按 Enter 误发草稿）
    const composer = (e.target && e.target.closest) ? e.target.closest(dom.COMPOSER_SELECTOR) : null;
    if (!composer || pendingSend) return;
    if (!getComposerText(composer)) return; // 空内容：不拦截

    // session 模式不需要注入时完全放行原生 Enter，不拦截再模拟
    if (!shouldInjectForComposer(composer)) return;

    // 拦截前确认发送按钮可用；找不到则放行原 Enter（避免吞键后消息留在输入框）
    const probeBtn = findSendButton(composer, null);
    if (!probeBtn || probeBtn.disabled) return;

    log.debug('intercept enter');
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    pendingSend = true;
    handleSend(composer, null, 'enter').finally(() => { pendingSend = false; });
  }

  function onInput(e) {
    if (!enabled) return;
    rememberComposer(e.target);
  }

  /** 安装拦截。返回安装状态。挂到 window capture，保证早于页面 document capture handler。 */
  function init() {
    if (typeof document === 'undefined') return { installed: false, reason: 'no document' };
    if (window.__solWatchSenderHookInstalled) return { installed: true, already: true };
    window.addEventListener('click', onClick, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('input', onInput, true);
    window.__solWatchSenderHookInstalled = true;
    return { installed: true };
  }

  return { init, handleSend, getComposerText, injectIntoComposer, triggerSend };
});

/**
 * Sol Watch — metadata-hider
 * 隐藏已渲染的时间元数据行（新版 ⟦t=...⟧ / 旧版 [SOL_TIME ...]），只改样式，
 * 不改页面数据。只处理整条消息绝对开头的第一个 token，最多一个。
 *
 * 真实 ChatGPT 可能把元数据渲染成单个文本节点、独立块、内层 span 或 <br> 结构。
 * 因此本模块用 splitText 把开头 token（连同注入换行）拆出，包成 display:none
 * 的 span；正文和后续示例原样保留。无法匹配时不做任何改动（fail-safe）。
 * - copy 事件只剥离绝对开头的一条元数据（capture 阶段，fail-safe）。
 */
(function (root, factory) {
  const api = factory(
    (typeof window !== 'undefined' && window.SolWatchMetadata) ||
    (typeof require === 'function' ? require('../common/metadata.js') : null),
    (typeof window !== 'undefined' && window.SolWatchLogger) ||
    (typeof require === 'function' ? require('../common/logger.js') : null)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SolWatchMetadataHider = api;
})(typeof window !== 'undefined' ? window : null, function (metadata, logger) {
  'use strict';

  const log = logger || { debug() {}, warn() {}, error() {} };
  const HIDDEN_MARK = 'data-solwatch-hidden';
  const HIDDEN_BLOCK_MARK = 'data-solwatch-hidden-block';
  const FIRST_VISIBLE_MARK = 'data-solwatch-first-visible';
  const BLOCK_TAGS = /^(P|DIV|LI|SECTION|ARTICLE)$/i;
  // 零宽/不可见字符不算内容（ChatGPT 有时会插 ZWSP）
  const INVISIBLE_RE = /[\s\u200b\u200c\u200d\u2060\ufeff]/g;
  const LEADING_INVISIBLE_RE = /^[\s\u200b\u200c\u200d\u2060\ufeff]*/;

  function hasOnlyInvisibleText(text) {
    return !String(text || '').replace(INVISIBLE_RE, '');
  }

  /** 向上找到真正的块级容器（p/div/li…），而不是内层 span wrapper。 */
  function closestBlock(el) {
    let node = el;
    while (node && node.nodeType === 1 && !BLOCK_TAGS.test(node.tagName || '')) {
      node = node.parentElement;
    }
    return node && node.nodeType === 1 ? node : (el && el.parentElement);
  }

  /** 去掉隐藏 span 后，块是否没有可见内容（只剩空白/br/零宽字符）。 */
  function isEffectivelyEmpty(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.querySelector && el.querySelector(`[${HIDDEN_MARK}]`)) {
      const clone = el.cloneNode(true);
      clone.querySelectorAll(`[${HIDDEN_MARK}]`).forEach((n) => n.remove());
      if (!hasOnlyInvisibleText(clone.textContent)) return false;
      if (clone.querySelector && clone.querySelector('img,svg,video,audio,canvas,button,input')) return false;
      return true;
    }
    if (!hasOnlyInvisibleText(el.textContent)) return false;
    if (el.querySelector && el.querySelector('img,svg,video,audio,canvas,button,input')) return false;
    return true;
  }

  /** 清掉节点开头连续的 <br> 与纯空白文本（注入的 "\n\n" 在这些渲染器里
   *  会变成 br；只清开头，正文中间的换行不动）。 */
  function stripLeadingBreaks(node) {
    let child = node && node.firstChild;
    while (child) {
      if (child.nodeType === 3 && hasOnlyInvisibleText(child.textContent)) {
        const next = child.nextSibling;
        child.remove();
        child = next;
        continue;
      }
      if (child.nodeType === 1 && child.tagName === 'BR') {
        const next = child.nextSibling;
        child.remove();
        child = next;
        continue;
      }
      break;
    }
  }

  /** 清掉锚点之后、正文之前的 <br>/纯空白；会沿着"只包含隐藏元数据"的
   *  内层 span wrapper 向上走，处理 <p><span>时间 token</span><br><a>… 这种结构。 */
  function stripBreaksAfter(anchor) {
    let sibling = anchor && anchor.nextSibling;
    while (sibling) {
      if (sibling.nodeType === 3 && hasOnlyInvisibleText(sibling.textContent)) {
        const next = sibling.nextSibling;
        sibling.remove();
        sibling = next;
        continue;
      }
      if (sibling.nodeType === 1 && sibling.tagName === 'BR') {
        const next = sibling.nextSibling;
        sibling.remove();
        sibling = next;
        continue;
      }
      break;
    }
  }

  function stripBreaksUpToBlock(span, block) {
    let anchor = span;
    let guard = 0;
    while (anchor && anchor !== block && guard++ < 6) {
      stripBreaksAfter(anchor);
      const parent = anchor.parentElement;
      if (!parent || parent === block) break;
      // 父级里除了隐藏元数据还有别的内容时，不要再向外清
      if (!isEffectivelyEmpty(parent)) break;
      anchor = parent;
    }
  }

  /** 隐藏没有可见内容的块（避免隐藏元数据后仍占一行/一段的高度）。 */
  function hideEmptyBlock(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getAttribute && el.getAttribute(HIDDEN_BLOCK_MARK)) return false;
    if (!BLOCK_TAGS.test(el.tagName || '')) return false;
    if (!isEffectivelyEmpty(el)) return false;
    el.setAttribute(HIDDEN_BLOCK_MARK, '1');
    el.style.display = 'none';
    return true;
  }

  /** 注入的 "\n\n" 在块级渲染里会多出空段落；清掉紧邻的连续空块。 */
  function hideAdjacentBlankBlock(el) {
    let next = el && el.nextElementSibling;
    while (next) {
      // 已隐藏的块仍占着 DOM 位置，跳过它继续看下一个
      if (next.getAttribute && next.getAttribute(HIDDEN_BLOCK_MARK)) {
        next = next.nextElementSibling;
        continue;
      }
      if (hideEmptyBlock(next)) {
        next = next.nextElementSibling;
        continue;
      }
      // 第一个有内容的块：它开头可能还挂着注入换行渲染出的 <br>；
      // 元数据段隐藏后它不再是 :first-child，默认 margin-top 会变成
      // 气泡顶部的一行空白 → 标记后由 CSS 去掉 margin。
      next.setAttribute(FIRST_VISIBLE_MARK, '1');
      stripLeadingBreaks(next);
      return true;
    }
    return false;
  }

  /** 第一个可见文本节点之前是否已有真实视觉内容（图片/视频等）或正文。
   *  用于保证只隐藏整条消息绝对开头的那一个 token。 */
  function hasVisibleContentBefore(container, node) {
    try {
      const range = document.createRange();
      range.setStart(container, 0);
      range.setEnd(node, 0);
      const fragment = range.cloneContents();
      fragment.querySelectorAll(`[${HIDDEN_MARK}],[${HIDDEN_BLOCK_MARK}]`)
        .forEach((n) => n.remove());
      // 只把真正的视觉内容当作“前面的内容”；复制/编辑按钮等 UI 控件不算。
      if (fragment.querySelector && fragment.querySelector('img,video,audio,canvas,iframe,object,embed')) {
        return true;
      }
      return !hasOnlyInvisibleText(fragment.textContent || '');
    } catch (_e) {
      return false;
    }
  }

  /** 找容器内“绝对开头”的第一个时间元数据文本节点，最多一个。
   *  正文后面出现的旧版/新版示例、引用或代码块不属于元数据，不能隐藏。 */
  function findSolTimeTextNodes(container) {
    if (!container) return [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentNode;
      if (!parent) continue;
      // 已经包在隐藏 span 里：说明开头元数据已处理，不要再碰后面的正文
      if (parent.closest && parent.closest('[' + HIDDEN_MARK + ']')) return [];
      const text = node.textContent || '';
      const leading = text.match(LEADING_INVISIBLE_RE);
      const offset = leading ? leading[0].length : 0;
      const rest = text.slice(offset);
      if (!rest) continue; // 纯空白/零宽字符，继续找下一个
      if (!metadata.matchSolTimePrefix(rest)) return []; // 第一个可见文本不是元数据
      if (hasVisibleContentBefore(container, node)) return [];
      return [node];
    }
    return [];
  }

  /** 隐藏：把时间元数据 token 本体从文本节点拆出，包成 display:none span。
   *  只匹配 token 本身（旧版精确到 `"]`，新版精确到 `⟧`），正文里的 `]` 不会被误藏。
   *  node.splitText(len) 后：node 保留前 len 个字符（元数据行），
   *  返回值是后半（正文）。包前半 node，正文保持可见。 */
  function hideSolTimeLine(container) {
    const nodes = findSolTimeTextNodes(container);
    let wrapped = 0;
    for (const node of nodes) {
      try {
        const text = node.textContent || '';
        const leading = text.match(LEADING_INVISIBLE_RE);
        const offset = leading ? leading[0].length : 0;
        const prefix = metadata.matchSolTimePrefix(text.slice(offset));
        if (!prefix) continue;
        let len = offset + prefix.length;
        // 连同紧随其后的换行一起隐藏：注入格式是 line + "\n" + 正文；
        // 旧消息里可能还有空行，也一并清掉，避免气泡顶部多一行空白。
        while (len < text.length && (text.charAt(len) === '\n' || text.charAt(len) === '\r')) {
          len += 1;
        }
        node.splitText(len); // node 现在 = 元数据 token + 注入换行（前半）
        const block = closestBlock(node.parentNode);
        const span = document.createElement('span');
        span.setAttribute(HIDDEN_MARK, '1');
        span.style.display = 'none';
        node.parentNode.insertBefore(span, node);
        span.appendChild(node);
        // 同一行内：元数据可能被内层 span 包着，后面才是 <br> 和链接
        stripBreaksUpToBlock(span, block);
        // 块级渲染：元数据独立成段时，隐藏整段；再清掉注入换行产生的空段
        if (hideEmptyBlock(block)) {
          hideAdjacentBlankBlock(block);
        } else {
          // 元数据和正文在同一个 <p>（链接/Markdown 消息常见）：这个 <p>
          // 自己的 margin-top 就是气泡顶部那行空白，标记后 CSS 清零。
          block.setAttribute(FIRST_VISIBLE_MARK, '1');
        }
        wrapped++;
      } catch (err) {
        log.warn('wrap sol_time line failed', err);
      }
    }
    return wrapped > 0;
  }

  /** 恢复：拆掉包裹 span，把文本节点合并回去；恢复被隐藏的空块 */
  function showSolTimeLine(container) {
    if (!container || !container.querySelectorAll) return false;
    const spans = container.querySelectorAll('[' + HIDDEN_MARK + ']');
    spans.forEach((span) => {
      const parent = span.parentNode;
      if (!parent) return;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      try { parent.normalize(); } catch (_e) { /* ignore */ }
    });
    const blocks = Array.from(container.querySelectorAll('[' + HIDDEN_BLOCK_MARK + ']'));
    if (container.getAttribute && container.getAttribute(HIDDEN_BLOCK_MARK)) blocks.push(container);
    blocks.forEach((el) => {
      el.removeAttribute(HIDDEN_BLOCK_MARK);
      el.style.display = '';
    });
    container.querySelectorAll('[' + FIRST_VISIBLE_MARK + ']').forEach((el) => {
      el.removeAttribute(FIRST_VISIBLE_MARK);
    });
    return spans.length > 0 || blocks.length > 0;
  }

  /** 按设置统一应用：默认隐藏元数据行；showSolTimeDebugLine=true 时恢复可见。 */
  function applyToContainer(container, showDebugLine) {
    if (!container) return { hidden: false, visible: false };
    if (showDebugLine) {
      const visible = showSolTimeLine(container);
      return { hidden: false, visible };
    }
    const hidden = hideSolTimeLine(container);
    return { hidden, visible: false };
  }

  /** 复制剥离：capture 阶段拦截 copy，仅在选区绝对开头是元数据时写入剥离文本 */
  function installCopyStrip() {
    if (typeof document === 'undefined' || window.__solWatchCopyStripInstalled) return false;
    window.__solWatchCopyStripInstalled = true;
    document.addEventListener('copy', (e) => {
      try {
        const sel = (window.getSelection && window.getSelection().toString()) || '';
        let text = sel;
        if (!text && e.clipboardData && e.clipboardData.getData) {
          text = e.clipboardData.getData('text/plain');
        }
        // 只处理绝对开头的一条元数据；正文后面的示例不能因为复制被删掉
        if (!text || !metadata.matchSolTimePrefix(text)) return;
        const cleaned = metadata.stripLeadingSolTime(text);
        const dt = e.clipboardData;
        if (dt) {
          e.preventDefault();
          dt.setData('text/plain', cleaned);
          return;
        }
        e.preventDefault();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(cleaned).catch(() => {});
        }
      } catch (err) {
        log.warn('copy strip failed', err);
      }
    }, true);
    return true;
  }

  return { findSolTimeTextNodes, hideSolTimeLine, showSolTimeLine, applyToContainer, installCopyStrip };
});

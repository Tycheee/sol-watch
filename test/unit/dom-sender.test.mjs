/**
 * Sol Watch — DOM / 发送链路回归测试（jsdom）
 * 覆盖 review 指出的缺陷：
 * 1) 隐藏空 textarea 抢走注入目标；
 * 2) execCommand 失败仍报成功/照常发送；
 * 3) 设置只更新缓存，显示模块不应用；
 * 4) 发送动作失败仍吞键/留下注入内容；
 * 5) 同一行正文含 `]` 时被当成元数据一起隐藏；
 * 6) 无 create_time 时元数据未隐藏；
 * 7) 正文后的 SOL_TIME 示例/代码块被误藏；
 * 8) requestSubmit fallback 遗留 resumeSend，下一条消息绕过注入；
 * 9) synthetic click 未到达 window（按钮脱离文档/被更早 handler 吞掉）时
 *    resumeSend 泄漏，下一次真实 Enter 被误放行。
 * 验收：实际发送内容 = 一行时间元数据 + 完整正文。
 */
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://chatgpt.com/c/c1',
  pretendToBeVisual: true
});
const w = dom.window;

globalThis.window = w;
globalThis.document = w.document;
globalThis.Node = w.Node;
globalThis.NodeFilter = w.NodeFilter;
globalThis.Element = w.Element;
globalThis.HTMLElement = w.HTMLElement;
globalThis.HTMLTextAreaElement = w.HTMLTextAreaElement;
globalThis.HTMLInputElement = w.HTMLInputElement;
globalThis.Event = w.Event;
globalThis.CustomEvent = w.CustomEvent;
globalThis.KeyboardEvent = w.KeyboardEvent;
globalThis.MouseEvent = w.MouseEvent;
globalThis.InputEvent = w.InputEvent;
globalThis.Range = w.Range;
globalThis.getComputedStyle = w.getComputedStyle.bind(w);
delete globalThis.chrome; // MAIN world：没有 chrome.storage

const timeFormat = require('../../src/common/time-format.js');
const metadata = require('../../src/common/metadata.js');
const settings = require('../../src/content/settings.js');
const domq = require('../../src/content/dom-queries.js');
require('../../src/content/fiber-adapter.js');
require('../../src/content/time-reader.js');
const hider = require('../../src/content/metadata-hider.js');
require('../../src/content/ui-overlay.js');
const anchor = require('../../src/content/session-anchor.js');
require('../../src/content/ui-notice.js');
const sender = require('../../src/content/sender-hook.js');
const main = require('../../src/content/main.js');

// 背景扫描/定时器不参与断言，避免测试进程被 setInterval 拖住
globalThis.MutationObserver = undefined;
globalThis.setInterval = () => ({ unref() {} });

const failures = [];
w.addEventListener('solwatch-send-failed', (e) => failures.push(e.detail && e.detail.reason));

const SINCE_TS = 1767180600; // 2026-09-30T21:30:00+08:00

function reset() {
  document.body.innerHTML = '';
  failures.length = 0;
  anchor.reset();
  anchor.setNowForTests(null);
  settings.applyExternalSettings({ ...settings.DEFAULTS, sendTimeMode: 'always' });
  try {
    const sel = w.getSelection();
    if (sel) sel.removeAllRanges();
  } catch (_e) { /* ignore */ }
  installInsertText(true);
}

function setMode(mode) {
  settings.applyExternalSettings({ ...settings.DEFAULTS, sendTimeMode: mode });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return true;
    await wait(15);
  }
  return false;
}

/** 用 jsdom 的 Selection/Range 实现 execCommand('insertText') */
function installInsertText(ok) {
  document.execCommand = (cmd, _ui, text) => {
    if (cmd !== 'insertText' || !ok) return false;
    const sel = w.getSelection();
    if (!sel || !sel.rangeCount) return false;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  };
}

function buildForm({ hiddenTextarea = false, editorText = '', button = true } = {}) {
  const form = document.createElement('form');
  if (hiddenTextarea) {
    const ta = document.createElement('textarea');
    ta.id = 'hidden-composer';
    ta.style.display = 'none';
    ta.value = '';
    form.appendChild(ta);
  }
  const editor = document.createElement('div');
  editor.id = 'editor';
  editor.setAttribute('contenteditable', 'true');
  editor.textContent = editorText;
  form.appendChild(editor);
  let btn = null;
  if (button) {
    btn = document.createElement('button');
    btn.id = 'send';
    btn.setAttribute('aria-label', '发送');
    btn.type = 'button';
    form.appendChild(btn);
  }
  document.body.appendChild(form);
  return { form, editor, button: btn, hidden: form.querySelector('#hidden-composer') };
}

function copyTextThroughExtension(text) {
  try {
    const sel = w.getSelection();
    if (sel) sel.removeAllRanges();
  } catch (_e) { /* ignore */ }
  const dt = {
    data: text,
    setData(_type, value) { this.data = value; },
    getData() { return this.data; }
  };
  const ev = new w.Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: dt });
  document.dispatchEvent(ev);
  return dt.data;
}

function buildUserTurn(text, ts = SINCE_TS) {
  const turn = document.createElement('div');
  turn.setAttribute('data-turn-key', 't-user');
  turn.setAttribute('data-create-time', String(ts)); // timeReader 从 candidate/closest 读取
  const bubble = document.createElement('div');
  bubble.setAttribute('data-user-message-bubble', '');
  bubble.setAttribute('data-create-time', String(ts));
  bubble.textContent = text;
  turn.appendChild(bubble);
  document.body.appendChild(turn);
  return { turn, bubble };
}

function visibleText(bubble) {
  const clone = bubble.cloneNode(true);
  clone.querySelectorAll('[data-solwatch-hidden],[data-solwatch-hidden-block]')
    .forEach((n) => n.remove());
  return clone.textContent;
}

// 发送拦截只需安装一次（同一个 jsdom window）
sender.init();
main.init();

export const name = 'dom-sender';

export const tests = [
  {
    name: '隐藏的空 textarea 不会被选为注入目标',
    async fn() {
      reset();
      const { form, editor, button, hidden } = buildForm({
        hiddenTextarea: true,
        editorText: '正文内容'
      });
      const picked = domq.getComposerFromButton(button);
      if (picked !== editor) return `选中了错误编辑器: ${picked && picked.id}`;
      if (domq.getComposerFromButton(button) === hidden) return '选中的是隐藏 textarea';

      let sent = null;
      button.addEventListener('click', () => { sent = editor.textContent; });
      button.click();
      if (!await waitFor(() => sent != null)) return '点击后没有触发发送';
      if (metadata.countSolTimeLines(sent) !== 1) return `时间戳行数=${metadata.countSolTimeLines(sent)}: ${sent.slice(0, 80)}`;
      if (!sent.includes('正文内容')) return '正文丢失';
      return null;
    }
  },
  {
    name: '实际发送内容 = 一行时间元数据 + 完整正文（contenteditable）',
    async fn() {
      reset();
      const body = '第一行\n第二行 **Markdown** [链接]';
      const { button, editor } = buildForm({ editorText: body });
      let sent = null;
      button.addEventListener('click', () => { sent = editor.textContent; });
      button.click();
      if (!await waitFor(() => sent != null)) return '没有发送';
      if (metadata.countSolTimeLines(sent) !== 1) return `时间戳行数=${metadata.countSolTimeLines(sent)}`;
      if (!sent.includes(body)) return `正文不完整: ${sent}`;
      if (!metadata.isCompactSolTimeLine(sent.split(/\r?\n/)[0])) return '首行不是紧凑时间元数据';
      const nl = sent.indexOf('\n');
      if (nl < 0 || sent.charAt(nl + 1) === '\n') return '时间戳与正文之间不应有空行';
      return null;
    }
  },
  {
    name: '实际发送内容 = 一行时间元数据 + 完整正文（textarea）',
    async fn() {
      reset();
      const ta = document.createElement('textarea');
      ta.value = 'textarea 正文';
      const form = document.createElement('form');
      form.appendChild(ta);
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', '发送');
      btn.type = 'button';
      form.appendChild(btn);
      document.body.appendChild(form);

      let sent = null;
      btn.addEventListener('click', () => { sent = ta.value; });
      btn.click();
      if (!await waitFor(() => sent != null)) return '没有发送';
      if (metadata.countSolTimeLines(sent) !== 1) return `时间戳行数=${metadata.countSolTimeLines(sent)}`;
      if (!sent.includes('textarea 正文')) return '正文丢失';
      const nl = sent.indexOf('\n');
      if (nl < 0 || sent.charAt(nl + 1) === '\n') return '时间戳与正文之间不应有空行';
      return null;
    }
  },
  {
    name: 'execCommand 返回 false 时注入失败、不发送、草稿不变',
    async fn() {
      reset();
      const body = '注入会失败';
      const { editor, button } = buildForm({ editorText: body });
      installInsertText(false);
      let clicked = 0;
      button.addEventListener('click', () => { clicked++; });

      const ok = await sender.handleSend(editor, button, 'test');
      if (ok !== false) return `handleSend 应返回 false，got ${ok}`;
      if (editor.textContent !== body) return `草稿被改动: ${editor.textContent}`;
      if (clicked !== 0) return `注入失败后仍然发送了 ${clicked} 次`;
      if (!failures.includes('inject')) return `缺少 inject 失败事件: ${failures}`;
      const notice = document.querySelector('.solwatch-notice');
      if (!notice) return '注入失败没有用户可见提示';
      if (!notice.textContent.includes('未能注入时间')) return `提示文案不对: ${notice.textContent}`;
      if (notice.style.pointerEvents !== 'none') return '提示可能遮挡输入框（pointer-events 未关闭）';
      return null;
    }
  },
  {
    name: '发送按钮失效时恢复草稿且不吞掉成功（不留下注入内容）',
    async fn() {
      reset();
      const body = '发送会失败';
      const { form, editor, button } = buildForm({ editorText: body });
      form.requestSubmit = undefined;
      let clicked = 0;
      button.addEventListener('click', () => { clicked++; });

      editor.dispatchEvent(new w.KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true
      }));
      button.disabled = true; // 拦截后按钮失效（页面常见：生成中按钮消失）

      const failed = await waitFor(() => failures.includes('send'), 3000);
      if (!failed) return `缺少 send 失败事件: ${failures}`;
      if (clicked !== 0) return `按钮失效后仍发送了 ${clicked} 次`;
      if (editor.textContent !== body) return `草稿未恢复: ${editor.textContent}`;
      return null;
    }
  },
  {
    name: '设置变更会应用到显示模块（时间标签 + 调试行）',
    async fn() {
      reset();
      const sol = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'), 'Asia/Shanghai');
      const { bubble } = buildUserTurn(sol + '\n正文 [链接]');

      main.scan();
      if (!bubble.querySelector('.solwatch-time-label')) return '初始化后没有时间标签';
      if (!bubble.querySelector('[data-solwatch-hidden]')) return '初始未隐藏元数据行';

      // bridge 推送：关闭用户时间 + 显示调试行
      // jsdom 的 postMessage 不设置 source，这里按浏览器语义派发 MessageEvent
      w.dispatchEvent(new w.MessageEvent('message', {
        source: w,
        data: {
          source: 'solwatch-bridge',
          type: 'solwatch-settings',
          settings: { ...settings.DEFAULTS, showUserTime: false, showSolTimeDebugLine: true }
        }
      }));
      if (!await waitFor(() => !bubble.querySelector('.solwatch-time-label'))) {
        return '关闭 showUserTime 后标签仍在（设置未应用）';
      }
      if (!await waitFor(() => !bubble.querySelector('[data-solwatch-hidden]'))) {
        return '打开 showSolTimeDebugLine 后元数据行仍被隐藏';
      }
      if (!visibleText(bubble).includes(sol)) return '调试行没有显示';
      return null;
    }
  },
  {
    name: '同一行正文含 ] 时只隐藏元数据，不误藏正文',
    async fn() {
      reset();
      const sol = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'), 'Asia/Shanghai');
      const bubble = document.createElement('div');
      bubble.setAttribute('data-user-message-bubble', '');
      // 同一行：元数据后紧跟正文，正文里含 ] —— 旧贪婪正则会吞掉整行
      bubble.textContent = `${sol} 正文 [链接] 还在`;
      document.body.appendChild(bubble);

      const hidden = hider.hideSolTimeLine(bubble);
      if (!hidden) return '没有隐藏元数据行';
      const span = bubble.querySelector('[data-solwatch-hidden]');
      if (!span) return '缺少隐藏 span';
      if (span.textContent.includes('正文')) return `隐藏 span 吞掉了正文: ${span.textContent}`;
      if (!visibleText(bubble).includes('正文 [链接] 还在')) {
        return `可见正文被误藏: ${visibleText(bubble)}`;
      }
      return null;
    }
  },
  {
    name: '元数据被内层 span 包裹时，外层 <br> 也清掉（链接消息真实结构）',
    async fn() {
      reset();
      const sol = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'), 'Asia/Shanghai');
      const p = document.createElement('p');
      const wrap = document.createElement('span');
      wrap.textContent = sol;
      const br = document.createElement('br');
      const a = document.createElement('a');
      a.href = 'https://github.com/Tycheee/sol-watch';
      const linkSpan = document.createElement('span');
      linkSpan.textContent = 'https://github.com/Tycheee/sol-watch';
      a.appendChild(linkSpan);
      const tail = document.createElement('span');
      tail.textContent = ' test';
      p.append(wrap, br, a, tail);
      document.body.appendChild(p);

      if (!hider.hideSolTimeLine(p)) return '没有隐藏';
      if (p.querySelectorAll('br').length !== 0) {
        return `外层 <br> 未清理（${p.querySelectorAll('br').length} 个）`;
      }
      if (!p.hasAttribute('data-solwatch-first-visible')) {
        return '正文段落未标记 first-visible（margin-top 会留下空行）';
      }
      if (!visibleText(p).includes('https://github.com/Tycheee/sol-watch')) {
        return '链接被误删/隐藏';
      }
      if (!visibleText(p).includes(' test')) return '正文尾部丢失';
      return null;
    }
  },
  {
    name: '链接/图片消息：<br> 与零宽空段不留下顶部空白',
    async fn() {
      reset();
      const sol = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'), 'Asia/Shanghai');

      // A. 同一块：SOL_TIME<br><br>正文 + 链接
      const sameBlock = document.createElement('div');
      sameBlock.innerHTML = `${sol}<br><br>正文 <a href="https://example.com">链接</a>`;
      document.body.appendChild(sameBlock);
      if (!hider.hideSolTimeLine(sameBlock)) return '同一块：没有隐藏';
      if (sameBlock.querySelectorAll('br').length !== 0) {
        return `同一块：仍有前导 <br>（${sameBlock.querySelectorAll('br').length} 个）`;
      }
      if (!visibleText(sameBlock).includes('正文')) return '同一块：正文丢失';

      // B. 块级：元数据 / 空段 / 图片 / 正文，空段和 br 都要清掉
      const blocky = document.createElement('div');
      const pSol = document.createElement('p');
      pSol.textContent = sol;
      const pBlank = document.createElement('p');
      pBlank.innerHTML = '<br>';
      const pImage = document.createElement('p');
      const img = document.createElement('img');
      pImage.appendChild(img);
      const pBody = document.createElement('p');
      pBody.textContent = '正文图片后面';
      blocky.append(pSol, pBlank, pImage, pBody);
      document.body.appendChild(blocky);
      if (!hider.hideSolTimeLine(blocky)) return '块级：没有隐藏';
      if (pSol.style.display !== 'none') return '块级：元数据段未隐藏';
      if (pBlank.style.display !== 'none') return '块级：空段未隐藏';
      if (pImage.style.display === 'none') return '块级：图片段被误隐藏';
      if (!pImage.hasAttribute('data-solwatch-first-visible')) {
        return '块级：第一个可见段未标记（margin-top 会留下空行）';
      }
      if (!visibleText(blocky).includes('正文图片后面')) return '块级：正文丢失';

      // C. 零宽字符组成的空段
      const zwsp = document.createElement('div');
      const zSol = document.createElement('p');
      zSol.textContent = sol;
      const zBlank = document.createElement('p');
      zBlank.textContent = '\u200b';
      const zBody = document.createElement('p');
      zBody.textContent = '正文';
      zwsp.append(zSol, zBlank, zBody);
      document.body.appendChild(zwsp);
      hider.hideSolTimeLine(zwsp);
      if (zBlank.style.display !== 'none') return '零宽空段未隐藏';
      return null;
    }
  },
  {
    name: '块级渲染：隐藏元数据段与注入空段，气泡顶部无空白',
    async fn() {
      reset();
      const sol = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'), 'Asia/Shanghai');
      const bubble = document.createElement('div');
      const pSol = document.createElement('p');
      pSol.textContent = sol;
      const pBlank = document.createElement('p'); // 注入的 "\n\n" 渲染成的空段
      const pBody = document.createElement('p');
      pBody.textContent = '正文在这里';
      bubble.append(pSol, pBlank, pBody);
      document.body.appendChild(bubble);

      if (!hider.hideSolTimeLine(bubble)) return '没有隐藏';
      if (pSol.style.display !== 'none') return `元数据段未隐藏: ${pSol.style.display}`;
      if (pBlank.style.display !== 'none') return '注入空段未隐藏（顶部仍会多一行）';
      if (!pBody.hasAttribute('data-solwatch-first-visible')) {
        return '正文段未标记，margin-top 会留下空行';
      }
      if ((visibleText(bubble) || '').trim() !== '正文在这里') {
        return `可见内容异常: ${JSON.stringify(visibleText(bubble))}`;
      }

      // 调试行开关恢复
      hider.showSolTimeLine(bubble);
      if (pSol.style.display === 'none') return '恢复后元数据段仍隐藏';
      if (pBlank.style.display === 'none') return '恢复后空段仍隐藏';
      if (!bubble.textContent.includes(sol)) return '恢复后元数据行丢失';
      return null;
    }
  },
  {
    name: '元数据行独立成行时正常隐藏，正文完整且不留下空白首行',
    async fn() {
      reset();
      const sol = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'), 'Asia/Shanghai');
      const bubble = document.createElement('div');
      bubble.textContent = `${sol}\n\n正文第一行\n第二行 [引用]`;
      document.body.appendChild(bubble);
      if (!hider.hideSolTimeLine(bubble)) return '没有隐藏';
      const visible = visibleText(bubble);
      if (visible !== '正文第一行\n第二行 [引用]') {
        return `气泡顶部仍有空白/正文不完整: ${JSON.stringify(visible)}`;
      }
      return null;
    }
  },
  {
    name: 'create_time 读取失败时仍隐藏新旧元数据（隐藏与标签解耦）',
    async fn() {
      reset();
      const compact = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'));
      const legacy = '[SOL_TIME v=1 sent_at="2026-09-30T21:30:00+08:00" timezone="Asia/Shanghai"]';
      const bubbles = [];
      for (const [i, line] of [compact, legacy].entries()) {
        const turn = document.createElement('div');
        turn.setAttribute('data-turn-key', 't-no-create-time-' + i);
        const bubble = document.createElement('div');
        bubble.setAttribute('data-user-message-bubble', '');
        bubble.textContent = line + '\n正文仍然要可见';
        turn.appendChild(bubble);
        document.body.appendChild(turn);
        bubbles.push({ line, bubble });
      }

      main.scan();
      for (const { line, bubble } of bubbles) {
        if (bubble.querySelector('.solwatch-time-label')) return `${line.slice(0, 8)} 无可靠时间却显示了标签`;
        if (!bubble.querySelector('[data-solwatch-hidden]')) {
          return `${line.slice(0, 8)} timeReader 返回 null 时元数据行没有被隐藏`;
        }
        if (!visibleText(bubble).includes('正文仍然要可见')) return '正文被误藏';
      }
      return null;
    }
  },
  {
    name: '正文后的新旧元数据示例/代码块不会被当成元数据隐藏',
    async fn() {
      reset();
      const compact = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'));
      const legacy = '[SOL_TIME v=1 sent_at="2026-09-30T21:30:00+08:00" timezone="Asia/Shanghai"]';
      const bubble = document.createElement('div');
      const pBody = document.createElement('p');
      pBody.textContent = '正文先出现';
      const preCompact = document.createElement('pre');
      const codeCompact = document.createElement('code');
      codeCompact.textContent = compact + ' 紧凑示例，不是元数据';
      preCompact.appendChild(codeCompact);
      const preLegacy = document.createElement('pre');
      const codeLegacy = document.createElement('code');
      codeLegacy.textContent = legacy + ' 旧版示例，不是元数据';
      preLegacy.appendChild(codeLegacy);
      bubble.append(pBody, preCompact, preLegacy);
      document.body.appendChild(bubble);

      if (hider.hideSolTimeLine(bubble)) return '正文后的示例被隐藏了';
      if (bubble.querySelector('[data-solwatch-hidden]')) return '出现了不该有的隐藏 span';
      const visible = visibleText(bubble);
      if (!visible.includes('正文先出现')) return '正文丢失';
      if (!visible.includes(compact + ' 紧凑示例')) return `紧凑示例被误藏: ${JSON.stringify(visible)}`;
      if (!visible.includes(legacy + ' 旧版示例')) return `旧版示例被误藏: ${JSON.stringify(visible)}`;
      return null;
    }
  },
  {
    name: '开头有新/旧多个元数据时只隐藏绝对开头的第一个',
    async fn() {
      reset();
      const compact = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'));
      const legacy = '[SOL_TIME v=1 sent_at="2026-09-30T21:30:00+08:00" timezone="Asia/Shanghai"]';
      const bubble = document.createElement('div');
      const pMeta = document.createElement('p');
      pMeta.textContent = compact;
      const pBody = document.createElement('p');
      pBody.textContent = '正文';
      const pExample = document.createElement('p');
      pExample.textContent = legacy + ' 第二处旧版示例';
      bubble.append(pMeta, pBody, pExample);
      document.body.appendChild(bubble);

      if (!hider.hideSolTimeLine(bubble)) return '开头的元数据没有隐藏';
      if (bubble.querySelectorAll('[data-solwatch-hidden]').length !== 1) {
        return `隐藏了 ${bubble.querySelectorAll('[data-solwatch-hidden]').length} 处，应该只有 1 处`;
      }
      if (pExample.style.display === 'none') return '第二处旧版元数据被整段隐藏';
      if (!visibleText(bubble).includes(legacy + ' 第二处旧版示例')) {
        return `第二处示例被误藏: ${JSON.stringify(visibleText(bubble))}`;
      }
      return null;
    }
  },
  {
    name: '复制只剥离开头元数据，正文后的新旧示例保持',
    fn() {
      reset();
      const compact = metadata.buildSolTimeLine(new w.Date('2026-09-30T21:30:00+08:00'));
      const legacy = '[SOL_TIME v=1 sent_at="2026-09-30T21:30:00+08:00" timezone="Asia/Shanghai"]';

      const leading = copyTextThroughExtension(compact + '\n正文\n第二行');
      if (leading !== '正文\n第二行') return `开头紧凑元数据未正确剥离: ${JSON.stringify(leading)}`;
      const leadingOld = copyTextThroughExtension(legacy + '\n正文\n第二行');
      if (leadingOld !== '正文\n第二行') return `开头旧版元数据未正确剥离: ${JSON.stringify(leadingOld)}`;

      const laterOld = '正文\n' + legacy + '\n示例';
      if (copyTextThroughExtension(laterOld) !== laterOld) return '正文后的旧版示例被剥离';
      const laterCompact = '正文\n' + compact + '\n示例';
      if (copyTextThroughExtension(laterCompact) !== laterCompact) return '正文后的紧凑示例被剥离';
      return null;
    }
  },
  {
    name: 'session: 首次注入、30 分钟内放行、满 30 分钟再注入',
    async fn() {
      reset();
      setMode('session');
      let now = new w.Date(2026, 9, 23, 10, 0, 0).getTime();
      anchor.setNowForTests(() => now);
      const { editor, button } = buildForm({ editorText: '第一条' });
      let sent = null;
      button.addEventListener('click', () => { sent = editor.textContent; });

      button.click();
      if (!await waitFor(() => sent != null)) return '首条没有发送';
      if (metadata.countSolTimeLines(sent) !== 1) return `首条应注入: ${sent}`;

      // 30 分钟内：Enter 和 click 都必须完全放行原生发送
      editor.textContent = '第二条';
      sent = null;
      const ev = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      if (!editor.dispatchEvent(ev)) return '30 分钟内不应拦截 Enter';
      button.click();
      await wait(200);
      if (sent !== '第二条') return `30 分钟内应原样发送: ${JSON.stringify(sent)}`;
      if (metadata.countSolTimeLines(editor.textContent) !== 0) return '30 分钟内不应注入';

      now += 30 * 60 * 1000;
      editor.textContent = '第三条';
      sent = null;
      button.click();
      if (!await waitFor(() => sent != null)) return '第三条没有发送';
      if (metadata.countSolTimeLines(sent) !== 1) return `满 30 分钟应注入: ${sent}`;
      return null;
    }
  },
  {
    name: 'session: conversation 隔离，页面生命周期 reset 后重新成为锚点',
    async fn() {
      reset();
      setMode('session');
      const now = new w.Date(2026, 9, 23, 11, 0, 0).getTime();
      anchor.setNowForTests(() => now);
      w.history.replaceState({}, '', '/c/c1');

      const a = buildForm({ editorText: 'c1 第一条' });
      let sentA = null;
      a.button.addEventListener('click', () => { sentA = a.editor.textContent; });
      a.button.click();
      if (!await waitFor(() => sentA != null)) return 'c1 第一条没有发送';
      if (metadata.countSolTimeLines(sentA) !== 1) return 'c1 第一条应注入';

      w.history.replaceState({}, '', '/c/c2');
      const b = buildForm({ editorText: 'c2 第一条' });
      let sentB = null;
      b.button.addEventListener('click', () => { sentB = b.editor.textContent; });
      b.button.click();
      if (!await waitFor(() => sentB != null)) return 'c2 第一条没有发送';
      if (metadata.countSolTimeLines(sentB) !== 1) return '另一个 conversation 应独立注入';

      w.history.replaceState({}, '', '/c/c1');
      const c = buildForm({ editorText: 'c1 第二条' });
      let sentC = null;
      c.button.addEventListener('click', () => { sentC = c.editor.textContent; });
      c.button.click();
      await wait(200);
      if (sentC !== 'c1 第二条') return '同一 conversation 30 分钟内不应注入';

      anchor.reset(); // 模拟页面生命周期重置
      const d = buildForm({ editorText: 'c1 刷新后' });
      let sentD = null;
      d.button.addEventListener('click', () => { sentD = d.editor.textContent; });
      d.button.click();
      if (!await waitFor(() => sentD != null)) return '刷新后没有发送';
      if (metadata.countSolTimeLines(sentD) !== 1) return '页面生命周期 reset 后应重新注入';
      return null;
    }
  },
  {
    name: 'session: 新会话 URL 从 pathname 变为 /c/<id> 后不重复注入',
    async fn() {
      reset();
      setMode('session');
      anchor.setNowForTests(() => new w.Date(2026, 9, 23, 11, 30, 0).getTime());
      w.history.replaceState({}, '', '/');

      const { editor, button } = buildForm({ editorText: '新会话第一条' });
      let sent = null;
      button.addEventListener('click', () => {
        sent = editor.textContent;
        // 模拟发送成功后 ChatGPT 把 URL 从 / 改成 /c/<id>
        w.history.replaceState({}, '', '/c/deadbeef');
      });
      button.click();
      if (!await waitFor(() => sent != null)) return '第一条没有发送';
      if (metadata.countSolTimeLines(sent) !== 1) return '第一条应注入';
      if (anchor.shouldInject('session', 'id:deadbeef', false)) {
        return `发送后没有记录 URL 变化后的 id 锚点（path 已记录=${!anchor.shouldInject('session', 'path:/', false)}，当前 URL=${w.location.pathname}）`;
      }

      editor.textContent = '新会话第二条';
      sent = null;
      button.click();
      await wait(200);
      if (sent !== '新会话第二条') return 'URL 变为 /c/<id> 后 30 分钟内不应再次注入';
      return null;
    }
  },
  {
    name: 'session: 编辑/重发旧格式和新格式都替换为本次时间',
    async fn() {
      reset();
      setMode('session');
      anchor.setNowForTests(() => new w.Date(2026, 9, 23, 12, 0, 0).getTime());
      w.history.replaceState({}, '', '/c/edit');
      anchor.markInjected('id:edit'); // 刚注入过；只有“首行已有元数据”能触发替换

      const legacy = '[SOL_TIME v=1 sent_at="2000-01-01T00:00:00+08:00" timezone="Asia/Shanghai"]';
      const compactOld = metadata.buildSolTimeLine(new Date(2000, 0, 2, 0, 0, 0));
      const { editor, button } = buildForm({ editorText: legacy + '\n正文一' });
      let sent = null;
      button.addEventListener('click', () => { sent = editor.textContent; });

      button.click();
      if (!await waitFor(() => sent != null)) return '旧格式重发没有发送';
      const firstLineOld = sent.split(/\r?\n/)[0];
      if (!metadata.isCompactSolTimeLine(firstLineOld)) return `旧格式未升级: ${firstLineOld}`;
      if (metadata.countSolTimeLines(sent) !== 1) return `重发后元数据行数不对: ${sent}`;
      if (!sent.endsWith('正文一')) return '旧格式重发正文丢失';

      editor.textContent = compactOld + '\n正文二';
      sent = null;
      button.click();
      if (!await waitFor(() => sent != null)) return '新格式重发没有发送';
      const firstLineNew = sent.split(/\r?\n/)[0];
      if (firstLineNew === compactOld) return '新格式重发没有更新时间';
      if (metadata.countSolTimeLines(sent) !== 1) return `新格式重发后元数据行数不对: ${sent}`;
      if (!sent.endsWith('正文二')) return '新格式重发正文丢失';
      return null;
    }
  },
  {
    name: 'always 每条注入；off 完全不注入并放行原生发送',
    async fn() {
      reset();
      setMode('always');
      const { editor, button } = buildForm({ editorText: 'always 第一条' });
      let sent = null;
      button.addEventListener('click', () => { sent = editor.textContent; });

      button.click();
      if (!await waitFor(() => sent != null)) return 'always 第一条没有发送';
      if (metadata.countSolTimeLines(sent) !== 1) return 'always 第一条应注入';
      editor.textContent = 'always 第二条';
      sent = null;
      button.click();
      if (!await waitFor(() => sent != null)) return 'always 第二条没有发送';
      if (metadata.countSolTimeLines(sent) !== 1) return 'always 第二条仍应注入';

      setMode('off');
      const off = buildForm({ editorText: 'off 原样发送' });
      let offSent = null;
      off.button.addEventListener('click', () => { offSent = off.editor.textContent; });
      off.button.click();
      await wait(200);
      if (offSent !== 'off 原样发送') return `off 应原样发送: ${JSON.stringify(offSent)}`;
      if (metadata.countSolTimeLines(off.editor.textContent) !== 0) return 'off 不应注入';
      const ev = new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      if (!off.editor.dispatchEvent(ev)) return 'off 不应拦截 Enter';
      return null;
    }
  },
  {
    name: 'session: 无法触发发送时不更新锚点，下一次仍会注入',
    async fn() {
      reset();
      setMode('session');
      anchor.setNowForTests(() => new w.Date(2026, 9, 23, 13, 0, 0).getTime());
      const first = buildForm({ editorText: '第一次会失败', button: false });
      first.form.requestSubmit = undefined;
      const ok = await sender.handleSend(first.editor, null, 'test');
      if (ok !== false) return '没有发送按钮时 handleSend 应返回 false';
      if (first.editor.textContent !== '第一次会失败') return '失败后草稿未恢复';

      const second = buildForm({ editorText: '第二次应注入' });
      let sent = null;
      second.button.addEventListener('click', () => { sent = second.editor.textContent; });
      second.button.click();
      if (!await waitFor(() => sent != null)) return '第二次没有发送';
      if (metadata.countSolTimeLines(sent) !== 1) return '失败发送不应占用会话锚点';
      return null;
    }
  },
  {
    name: '附件/链接/图片与多行正文在注入后保持不变',
    async fn() {
      reset();
      const { editor, button } = buildForm();
      editor.innerHTML = '<p>正文第一行</p><p>English 😀 <a href="https://example.com">链接</a></p><p><img src="x" alt="附件"></p>';
      const link = editor.querySelector('a');
      const img = editor.querySelector('img');
      let sent = null;
      button.addEventListener('click', () => { sent = editor.textContent; });

      button.click();
      if (!await waitFor(() => sent != null)) return '没有发送';
      if (metadata.countSolTimeLines(sent) !== 1) return `元数据行数=${metadata.countSolTimeLines(sent)}`;
      if (!sent.includes('正文第一行') || !sent.includes('English 😀')) return '正文不完整';
      if (!editor.querySelector('a') || editor.querySelector('a') !== link) return '链接被破坏';
      if (!editor.querySelector('img') || editor.querySelector('img') !== img) return '图片/附件被破坏';
      return null;
    }
  },
  {
    name: 'requestSubmit fallback 不遗留 resumeSend，下一次 Enter 仍被拦截',
    async fn() {
      reset();
      const { form, editor } = buildForm({ editorText: 'fallback 正文', button: false });
      let submitted = 0;
      form.requestSubmit = () => { submitted++; };
      const ok = await sender.handleSend(editor, null, 'test');
      if (!ok) return 'handleSend 应成功（fallback 已提交）';
      if (submitted !== 1) return `requestSubmit 调用次数=${submitted}`;
      if (metadata.countSolTimeLines(editor.textContent) !== 1) return 'fallback 后没有注入时间戳';

      // 模拟下一次用户 Enter：如果 resumeSend 泄漏，onKeyDown 会直接放行
      const next = buildForm({ editorText: '下一条消息' });
      let sent = null;
      next.button.addEventListener('click', () => { sent = next.editor.textContent; });
      const ev = new w.KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true
      });
      const notCanceled = next.editor.dispatchEvent(ev);
      if (notCanceled) return '下一次 Enter 没有被拦截（resumeSend 泄漏）';
      if (!await waitFor(() => sent != null)) return '拦截后没有继续发送';
      if (metadata.countSolTimeLines(sent) !== 1) return '下一条消息没有注入时间戳';
      if (!sent.includes('下一条消息')) return '下一条正文丢失';
      return null;
    }
  },
  {
    name: 'triggerSend 点击路径 resumeSend 同步复位（synthetic click 未到达 window 也不泄漏）',
    async fn() {
      reset();
      // 按钮“可见”但脱离文档：click() 事件不会传播到 window，我们的 capture
      // 监听器收不到，无法替我们复位 resumeSend。真实页面对应：按钮在
      // findSendButton 检查后被页面移出文档，或被更早注册的 window capture
      // handler stopImmediatePropagation。resumeSend 必须在 triggerSend 内部
      // 同步复位，不能指望下一次用户点击来碰运气清状态。
      const detached = document.createElement('div');
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      editor.textContent = '按钮已脱离文档';
      const btn = document.createElement('button');
      btn.setAttribute('aria-label', '发送');
      btn.type = 'button';
      detached.append(editor, btn); // 不挂到 document.body
      const triggered = await sender.triggerSend(editor, btn);
      if (!triggered) return 'detached 按钮应被选中并触发（jsdom 判定为可见）';

      // 下一次真实用户 Enter：若 resumeSend 泄漏会被直接放行（不拦截、不注入）
      const next = buildForm({ editorText: '下一条必须注入' });
      let sent = null;
      next.button.addEventListener('click', () => { sent = next.editor.textContent; });
      const ev = new w.KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true
      });
      const notCanceled = next.editor.dispatchEvent(ev);
      if (notCanceled) return '下一次 Enter 没有被拦截（resumeSend 泄漏）';
      if (!await waitFor(() => sent != null)) return '拦截后没有继续发送';
      if (metadata.countSolTimeLines(sent) !== 1) return '下一条消息没有注入时间戳';
      if (!sent.includes('下一条必须注入')) return '下一条正文丢失';
      return null;
    }
  }
];

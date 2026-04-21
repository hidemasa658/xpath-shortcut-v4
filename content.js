// ========== ショートカット監視（全フレーム共通） ==========
let shortcuts = [];

function isXPath(s) { return s && (s.startsWith('/') || s.startsWith('(')); }

function xpathInDoc(xpath, doc) {
  try {
    return doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
  } catch (e) { return null; }
}

function cssInDoc(sel, doc) {
  try { return doc.querySelector(sel); } catch (e) { return null; }
}

// ページ上のiframe情報を収集
function scanIframes() {
  const iframes = document.querySelectorAll('iframe');
  if (iframes.length === 0) return 'iframes=0';
  const info = [];
  iframes.forEach((iframe, idx) => {
    let origin = 'unknown';
    try {
      // contentDocumentにアクセスできれば同一オリジン
      const doc = iframe.contentDocument;
      origin = doc ? 'same-origin' : 'cross-origin(null)';
    } catch (e) {
      origin = 'cross-origin';
    }
    const src = (iframe.src || '').slice(0, 80);
    const vis = iframe.offsetWidth > 0 && iframe.offsetHeight > 0 ? 'visible' : 'hidden';
    info.push('iframe' + idx + ':' + origin + '|' + vis + '|' + src);
  });
  return 'iframes=' + iframes.length + ' [' + info.join(', ') + ']';
}

function findElement(selector) {
  if (!selector) return null;
  const fn = isXPath(selector) ? xpathInDoc : cssInDoc;
  let el = fn(selector, document);
  if (el) return el;
  // IDフォールバック
  if (isXPath(selector)) {
    const m = selector.match(/\[@id=["']([^"']+)["']\]/);
    if (m) { el = document.getElementById(m[1]); if (el) return el; }
  }
  // iframe検索
  for (const iframe of document.querySelectorAll('iframe')) {
    try {
      const doc = iframe.contentDocument;
      if (!doc) continue;
      el = fn(selector, doc);
      if (el) return el;
    } catch (e) {}
  }
  return null;
}

function codeToKeyName(code) {
  if (code.startsWith('Digit')) return code.replace('Digit', '');
  if (code.startsWith('Key')) return code.replace('Key', '');
  if (code.startsWith('Numpad')) return 'Num' + code.replace('Numpad', '');
  const map = {
    Backquote:'`',Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',
    Backslash:'\\',Semicolon:';',Quote:"'",Comma:',',Period:'.',
    Slash:'/',Space:'Space',Enter:'Enter',Backspace:'Backspace',
    Tab:'Tab',Escape:'Esc',Delete:'Delete',
    ArrowUp:'Up',ArrowDown:'Down',ArrowLeft:'Left',ArrowRight:'Right',
    F1:'F1',F2:'F2',F3:'F3',F4:'F4',F5:'F5',F6:'F6',
    F7:'F7',F8:'F8',F9:'F9',F10:'F10',F11:'F11',F12:'F12',
  };
  return map[code] || code;
}

function keyEventToString(e) {
  if (['Control','Alt','Shift','Meta'].includes(e.key)) return null;
  const p = [];
  if (e.ctrlKey || e.metaKey) p.push('Ctrl');
  if (e.altKey) p.push('Alt');
  if (e.shiftKey) p.push('Shift');
  p.push(codeToKeyName(e.code));
  return p.join('+');
}

function reportError(message, context, xpath, extra) {
  try {
    chrome.runtime.sendMessage({
      type: 'report-error',
      message: String(message),
      context: context || '',
      xpath: xpath || '',
      stack: extra || ((message instanceof Error) ? message.stack || '' : ''),
    });
  } catch(e) {}
}

// DOM状態のスナップショット収集（診断用）
function collectDOMSnapshot(target) {
  const info = [];
  // ページURL
  info.push('url=' + location.pathname.slice(0, 80));
  // host要素の状態
  const host = document.getElementById('xpath-shortcut-host');
  info.push('host=' + (host ? 'attached(next=' + (host.nextSibling ? host.nextSibling.nodeName : 'none') + ')' : 'detached'));
  // body直下の要素一覧（モーダル検出用）
  const children = Array.from(document.body.children).map(el => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const cls = el.className ? '.' + el.className.toString().split(' ')[0] : '';
    const vis = el.offsetHeight > 0 ? '' : '[hidden]';
    return tag + id + cls + vis;
  }).slice(0, 20);
  info.push('body-children=' + children.join(','));
  // 対象要素の周辺HTML
  if (target) {
    // 親3階層のouterHTML（文字数制限付き）
    let ctx = target;
    for (let i = 0; i < 3 && ctx.parentElement; i++) ctx = ctx.parentElement;
    const parentHTML = ctx.outerHTML.slice(0, 500);
    info.push('context-html=' + parentHTML);
    // textareaの場合、現在の値の長さとselectionStart
    if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
      info.push('value-len=' + (target.value || '').length);
      info.push('selStart=' + target.selectionStart);
      info.push('readonly=' + target.readOnly);
      info.push('disabled=' + target.disabled);
    }
  }
  // モーダル検出（.modal-mask等）
  const modals = document.querySelectorAll('.modal-mask, .modal, [role="dialog"], .overlay');
  if (modals.length > 0) {
    info.push('modals=' + modals.length + '(' + Array.from(modals).map(m => m.className.toString().split(' ')[0]).join(',') + ')');
  }
  return info.join(' | ');
}

let macroRunning = false;

// ショートカット間タイマー
let scTimer = { key: null, ts: 0, timeout: null };
function trackShortcutTiming(key) {
  const now = Date.now();
  if (scTimer.key && now - scTimer.ts <= 20000) {
    const elapsed = ((now - scTimer.ts) / 1000).toFixed(1);
    reportError(scTimer.key + ' -> ' + key + ': ' + elapsed + 's', 'timing', '');
  }
  clearTimeout(scTimer.timeout);
  scTimer.key = key;
  scTimer.ts = now;
  scTimer.timeout = setTimeout(() => { scTimer.key = null; }, 20000);
}

function onKeyDown(e) {
  // 修飾キーなし単体キーは即return（Enter/Space/Tab等への干渉を排除、Fキーは除外）
  if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
    if (!/^F([1-9]|1[0-2])$/.test(codeToKeyName(e.code))) return;
  }
  if (shortcuts.length === 0) return;
  const pressed = keyEventToString(e);
  if (!pressed) return;
  const match = shortcuts.find(s => s.key === pressed);
  if (!match) return;
  e.preventDefault();
  e.stopPropagation();
  trackShortcutTiming(match.key);

  try {
    // タブ切り替え（xpath が tab: で始まる場合）
    if (match.xpath && match.xpath.startsWith('tab:')) {
      const url = match.xpath.slice(4).trim();
      chrome.runtime.sendMessage({ type: 'switch-tab', url });
      return;
    }
    // テキスト挿入（xpath が text: で始まる場合）
    // 形式: text:S,O,A,P|//xpath
    if (match.xpath && match.xpath.startsWith('text:')) {
      insertText(match.xpath.slice(5));
      return;
    }
    // テキストコピー（xpath が copy: で始まる場合）
    // ピッカーモードで要素選択 → テキストをクリップボードにコピー
    if (match.xpath && match.xpath === 'copy:') {
      startCopyPicker();
      return;
    }
    // ランダム選択（xpath が random: で始まる場合）
    // 形式: random:N:セレクタ1|セレクタ2|セレクタ3 (Nは選択数、省略時1)
    if (match.xpath && match.xpath.startsWith('random:')) {
      const body = match.xpath.slice(7);
      let count = 1;
      let selectorsPart = body;
      const numMatch = body.match(/^(\d+):/);
      if (numMatch) {
        count = parseInt(numMatch[1]);
        selectorsPart = body.slice(numMatch[0].length);
      }
      const candidates = selectorsPart.split('|').map(s => s.trim()).filter(s => s);
      if (candidates.length === 0) return;
      // シャッフルしてcount個選択
      const shuffled = candidates.slice().sort(() => Math.random() - 0.5);
      const picks = shuffled.slice(0, Math.min(count, shuffled.length));
      for (const picked of picks) {
        clickWithRetry(picked, 3000);
      }
      return;
    }
    // ステップがあれば連続実行
    if (match.steps && match.steps.length > 0) {
      if (macroRunning) return;
      runMacro(match);
    } else {
      clickWithRetry(match.xpath, 3000);
    }
  } catch (err) {
    reportError(err, 'shortcut-click', match.xpath);
  }
}

// テキスト挿入: text:S,O,A,P|//xpath 形式
async function insertText(expr) {
  const pipeIdx = expr.indexOf('|');
  if (pipeIdx < 0) { reportError('text: 形式エラー（|が必要）', 'shortcut-click', expr); return; }
  const textPart = expr.substring(0, pipeIdx);
  const xpath = expr.substring(pipeIdx + 1).trim();
  const lines = textPart.split(',').join('\n') + '\n';
  const el = await waitForElement(xpath, 3000);
  if (!el) { reportError('要素が見つかりません', 'shortcut-click', xpath); return; }
  el.focus();
  // textarea / input
  if ('value' in el) {
    // カーソルを先頭に移動
    el.setSelectionRange(0, 0);
    // insertTextで挿入（React等のフレームワーク対応）
    const ok = document.execCommand('insertText', false, lines);
    if (!ok) {
      // fallback: 直接value操作
      el.value = lines + el.value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  // contenteditable
  } else if (el.isContentEditable) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, lines);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

async function clickWithRetry(xpath, maxWait) {
  const el = findElement(xpath);
  if (el) { el.click(); return; }
  // リトライ（最大maxWaitミリ秒）
  const found = await waitForElement(xpath, maxWait);
  if (found) {
    found.click();
  } else {
    reportError('要素が見つかりません | ' + scanIframes(), 'shortcut-click', xpath);
  }
}

async function runMacro(sc) {
  macroRunning = true;
  const allSteps = [{ xpath: sc.xpath, delay: 0 }];
  sc.steps.forEach(s => allSteps.push(s));
  await executeMacroFrom(allSteps, 0);
}

async function waitForElement(xpath, maxWait) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const el = findElement(xpath);
    if (el) return el;
    await new Promise(r => setTimeout(r, 300));
  }
  return null;
}

async function executeMacroFrom(allSteps, startIdx) {
  macroRunning = true;
  for (let i = startIdx; i < allSteps.length; i++) {
    const step = allSteps[i];
    // 待機
    if (step.delay > 0) {
      await new Promise(r => setTimeout(r, step.delay * 1000));
    }
    // 次ステップ位置を保存（遷移に備える）
    if (i + 1 < allSteps.length) {
      await chrome.storage.local.set({
        macroState: { allSteps, currentStep: i + 1, ts: Date.now() }
      });
    } else {
      await chrome.storage.local.remove('macroState');
    }
    // タブ切り替えステップ
    if (step.xpath && step.xpath.startsWith('tab:')) {
      const url = step.xpath.slice(4).trim();
      chrome.runtime.sendMessage({ type: 'switch-tab', url }, (res) => {
        if (res && res.ok && i + 1 < allSteps.length) {
          // 切り替え先タブでマクロ続行を指示
          chrome.runtime.sendMessage({ type: 'resume-macro', allSteps, currentStep: i + 1 });
        }
      });
      macroRunning = false;
      return; // このタブでの実行は終了
    }
    // テキスト挿入ステップ
    if (step.xpath && step.xpath.startsWith('text:')) {
      await insertText(step.xpath.slice(5));
      continue;
    }
    // キー送信ステップ (key:Enter, key:Tab, key:Escape 等)
    if (step.xpath && step.xpath.startsWith('key:')) {
      const keyName = step.xpath.slice(4).trim();
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true }));
      target.dispatchEvent(new KeyboardEvent('keyup', { key: keyName, bubbles: true }));
      if (keyName === 'Enter') {
        target.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
      }
      continue;
    }
    // ランダム選択ステップ
    if (step.xpath && step.xpath.startsWith('random:')) {
      const body = step.xpath.slice(7);
      let count = 1;
      let selectorsPart = body;
      const numMatch = body.match(/^(\d+):/);
      if (numMatch) {
        count = parseInt(numMatch[1]);
        selectorsPart = body.slice(numMatch[0].length);
      }
      const candidates = selectorsPart.split('|').map(s => s.trim()).filter(s => s);
      const shuffled = candidates.slice().sort(() => Math.random() - 0.5);
      const picks = shuffled.slice(0, Math.min(count, shuffled.length));
      for (const picked of picks) {
        const el = await waitForElement(picked, 5000);
        if (el) { el.click(); } else {
          reportError('マクロ: 要素が見つかりません (ステップ' + (i+1) + ') → スキップ | ' + scanIframes(), 'macro-step', picked, collectDOMSnapshot(null));
        }
      }
      continue;
    }
    // クリック実行（最大5秒リトライ）
    const el = await waitForElement(step.xpath, 5000);
    if (el) {
      el.click();
    } else {
      reportError('マクロ: 要素が見つかりません (ステップ' + (i+1) + ') → スキップ | ' + scanIframes(), 'macro-step', step.xpath, collectDOMSnapshot(null));
      // 停止せずスキップして次のステップへ
      continue;
    }
  }
  macroRunning = false;
}

function loadShortcuts() {
  chrome.runtime.sendMessage({ type: 'get-shortcuts' }, (res) => {
    if (chrome.runtime.lastError) return;
    shortcuts = res || [];
  });
}

// 全フレームでキー監視
loadShortcuts();
document.addEventListener('keydown', onKeyDown, true);

// キーイベントデバッグログ（テキスト入力要素でのEnter）
let lastDOMSnapshotTs = 0;
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const tag = (e.target.tagName || '').toLowerCase();
  const editable = e.target.isContentEditable;
  if (tag === 'textarea' || tag === 'input' || editable) {
    const hostInDOM = !!document.getElementById('xpath-shortcut-host');
    const elId = e.target.id || '';
    const elName = e.target.name || '';
    const elClass = (e.target.className || '').toString().slice(0, 40);
    const frame = (window === window.top) ? 'top' : 'iframe';
    const info = tag.toUpperCase() + (editable ? '[contenteditable]' : '') +
      ' | host=' + (hostInDOM ? 'attached' : 'detached') +
      ' | prevented=' + e.defaultPrevented +
      ' | frame=' + frame +
      ' | id=' + elId +
      ' | name=' + elName +
      ' | class=' + elClass;
    // DOM状態は5秒に1回だけ送信（ログ量制限）
    const now = Date.now();
    const snapshot = (now - lastDOMSnapshotTs > 5000) ? collectDOMSnapshot(e.target) : '';
    if (snapshot) lastDOMSnapshotTs = now;
    reportError('key-passthrough(capture): Enter in ' + info, 'key-debug', '', snapshot);
  }
}, true);

// bubbleフェーズでもEnter状態を確認
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const tag = (e.target.tagName || '').toLowerCase();
  const editable = e.target.isContentEditable;
  if (tag === 'textarea' || tag === 'input' || editable) {
    reportError('key-passthrough(bubble): Enter | prevented=' + e.defaultPrevented +
      ' | stopped=' + e.cancelBubble, 'key-debug', '');
  }
}, false);

// テキスト入力中はhost要素をDOMから一時除去（Nuxtフレームワーク干渉防止）
let hostRemovedForInput = false;
document.addEventListener('focusin', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'textarea' || tag === 'input' || e.target.isContentEditable) {
    const h = document.getElementById('xpath-shortcut-host');
    if (h && h.parentNode) {
      h.remove();
      hostRemovedForInput = true;
    }
  }
});
document.addEventListener('focusout', (e) => {
  if (hostRemovedForInput) {
    hostRemovedForInput = false;
    // 少し遅延して復帰（focusout→focusinの連続切り替え対策）
    setTimeout(() => {
      if (!hostRemovedForInput && !document.getElementById('xpath-shortcut-host') && barState.visible) {
        document.body.appendChild(host);
      }
    }, 200);
  }
});

// マクロ復帰チェック（ページ遷移後の続行）
if (window === window.top) {
  chrome.storage.local.get('macroState', (data) => {
    if (chrome.runtime.lastError || !data.macroState) return;
    const { allSteps, currentStep, ts } = data.macroState;
    if (ts && Date.now() - ts > 30000) {
      chrome.storage.local.remove('macroState');
      return;
    }
    if (currentStep < allSteps.length) {
      executeMacroFrom(allSteps, currentStep);
    } else {
      chrome.storage.local.remove('macroState');
    }
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'shortcuts-updated') loadShortcuts();
  if (msg.type === 'resume-macro') executeMacroFrom(msg.allSteps, msg.currentStep);
});

// ========== ピッカー（全フレーム共通） ==========
let picking = false, pickIdx = -1, hlEl = null;

function xpathStr(s) {
  if (!s.includes('"')) return '"' + s + '"';
  if (!s.includes("'")) return "'" + s + "'";
  return 'concat("' + s.replace(/"/g, '",\'"\',"') + '")';
}

function xpathCount(xp, doc) {
  try {
    return doc.evaluate(xp, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
  } catch(e) { return 0; }
}

function genSelector(el) {
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();

  // 1. ID
  if (el.id) return '//*[@id=' + xpathStr(el.id) + ']';

  // 2. 一意な属性
  const attrs = ['name','data-testid','data-id','aria-label','placeholder',
    'title','type','for','role','value','href','action','src'];
  for (const a of attrs) {
    const v = el.getAttribute(a);
    if (!v || v.length > 80) continue;
    const xp = '//' + tag + '[@' + a + '=' + xpathStr(v) + ']';
    if (xpathCount(xp, doc) === 1) return xp;
  }

  // 3. 属性の組み合わせ（type + name など）
  for (let a = 0; a < attrs.length; a++) {
    const v1 = el.getAttribute(attrs[a]);
    if (!v1) continue;
    for (let b = a + 1; b < attrs.length; b++) {
      const v2 = el.getAttribute(attrs[b]);
      if (!v2) continue;
      const xp = '//' + tag + '[@' + attrs[a] + '=' + xpathStr(v1) + ' and @' + attrs[b] + '=' + xpathStr(v2) + ']';
      if (xpathCount(xp, doc) === 1) return xp;
    }
  }

  // 4. テキスト（ボタン・リンク等）
  const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
  if (txt.length > 0 && txt.length < 50) {
    const xp1 = '//' + tag + '[normalize-space()=' + xpathStr(txt) + ']';
    if (xpathCount(xp1, doc) === 1) return xp1;
    // 部分一致
    if (txt.length >= 3) {
      const short = txt.substring(0, 30);
      const xp2 = '//' + tag + '[contains(normalize-space(),' + xpathStr(short) + ')]';
      if (xpathCount(xp2, doc) === 1) return xp2;
    }
  }

  // 5. クラス名（一意なもの）
  for (const cls of el.classList || []) {
    if (cls.length < 3) continue;
    const xp = '//' + tag + '[contains(@class,' + xpathStr(cls) + ')]';
    if (xpathCount(xp, doc) === 1) return xp;
  }

  // 6. パスベース（ID付き祖先からの相対パス）
  const parts = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur !== doc.documentElement) {
    let step = cur.tagName.toLowerCase();
    if (cur !== el && cur.id) {
      parts.unshift('*[@id=' + xpathStr(cur.id) + ']');
      return '//' + parts.join('/');
    }
    const parent = cur.parentElement;
    if (parent) {
      const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
      if (sibs.length > 1) step += '[' + (sibs.indexOf(cur) + 1) + ']';
    }
    parts.unshift(step);
    cur = parent;
  }
  return '//' + parts.join('/');
}

function showHL(el) {
  removeHL();
  const r = el.getBoundingClientRect();
  hlEl = document.createElement('div');
  hlEl.style.cssText = `position:fixed;z-index:2147483647;top:${r.top}px;left:${r.left}px;width:${r.width}px;height:${r.height}px;background:rgba(26,115,232,0.2);border:2px solid #1a73e8;pointer-events:none;border-radius:3px;`;
  document.body.appendChild(hlEl);
}
function removeHL() { if (hlEl) { hlEl.remove(); hlEl = null; } }

function onPMove(e) {
  if (!picking && !copyPicking) return;
  const host = document.getElementById('xpath-shortcut-host');
  if (host && (e.target === host || host.contains(e.target))) { removeHL(); return; }
  showHL(e.target);
}
function onPClick(e) {
  if (!picking) return;
  // Shadow Host(自分自身のUI)クリックは無視
  const host = document.getElementById('xpath-shortcut-host');
  if (host && (e.target === host || host.contains(e.target))) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  const sel = genSelector(e.target);
  const idx = pickIdx; // stopPicker が pickIdx を -1 にリセットする前に保存
  removeHL(); stopPicker();
  chrome.runtime.sendMessage({ type: 'xpath-picked', idx: idx, xpath: sel });
}
function onPKey(e) { if (picking && e.key === 'Escape') { removeHL(); stopPicker(); stopCopyPicker(); } }

// コピーピッカー
let copyPicking = false;
function onCopyClick(e) {
  if (!copyPicking) return;
  const host = document.getElementById('xpath-shortcut-host');
  if (host && (e.target === host || host.contains(e.target))) return;
  e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
  const text = (e.target.textContent || e.target.value || '').trim();
  removeHL(); stopCopyPicker();
  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      if (window === window.top && typeof toast === 'function') toast('コピーしました');
    }).catch(() => {});
  }
}
function startCopyPicker() {
  copyPicking = true;
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mousemove', onPMove, true);
  document.addEventListener('click', onCopyClick, true);
  document.addEventListener('keydown', onPKey, true);
}
function stopCopyPicker() {
  if (!copyPicking) return;
  copyPicking = false;
  document.body.style.cursor = '';
  document.removeEventListener('mousemove', onPMove, true);
  document.removeEventListener('click', onCopyClick, true);
  document.removeEventListener('keydown', onPKey, true);
}

function startPicker(idx) {
  picking = true; pickIdx = idx;
  document.body.style.cursor = 'crosshair';
  document.addEventListener('mousemove', onPMove, true);
  document.addEventListener('click', onPClick, true);
  document.addEventListener('keydown', onPKey, true);
}
function stopPicker() {
  picking = false; pickIdx = -1;
  document.body.style.cursor = '';
  document.removeEventListener('mousemove', onPMove, true);
  document.removeEventListener('click', onPClick, true);
  document.removeEventListener('keydown', onPKey, true);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'start-picker') startPicker(msg.idx);
});

// ========== フローティングバー（トップフレームのみ） ==========
if (window === window.top) {

// --- 診断: ページJSエラーキャプチャ（solamichi.jpのみ） ---
if (location.hostname.includes('solamichi')) {
  window.addEventListener('error', (ev) => {
    if (ev.filename && ev.filename.startsWith('chrome-extension://')) return;
    const msg = (ev.message || 'Unknown error') + ' at ' + (ev.filename || '') + ':' + (ev.lineno || 0);
    reportError(msg, 'page-error', '');
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const msg = (reason instanceof Error) ? reason.message : String(reason || 'Unhandled rejection');
    if (msg.includes('chrome-extension://')) return;
    reportError(msg, 'page-error', '');
  });
}

const ESC = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// Shadow DOMでホストページのスタイルと隔離
const host = document.createElement('div');
host.id = 'xpath-shortcut-host';
host.style.cssText = 'all:initial;position:fixed;z-index:2147483646;';
document.body.appendChild(host);

// --- 診断: DOM挿入ログ ---
reportError('host-element-inserted', 'dom-debug', '');
const shadow = host.attachShadow({ mode: 'closed' });

const wrapper = document.createElement('div');
wrapper.innerHTML = `
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  :host { font-family: -apple-system, 'Segoe UI', sans-serif; }

  .bar {
    position: fixed;
    background: rgba(30,30,30,0.92);
    border-radius: 8px;
    padding: 4px 6px;
    display: flex;
    align-items: center;
    gap: 3px;
    cursor: move;
    user-select: none;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    backdrop-filter: blur(8px);
    z-index: 2147483647;
    transition: opacity 0.15s;
  }
  .bar.hidden { display: none; }

  .bar .sc-badge {
    background: rgba(255,255,255,0.15);
    color: #fff;
    font-size: 9px;
    font-family: monospace;
    padding: 2px 5px;
    border-radius: 3px;
    white-space: nowrap;
    cursor: default;
  }
  .bar .sc-name {
    color: rgba(255,255,255,0.6);
    font-size: 8px;
    max-width: 50px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar .sc-item {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .bar .sep {
    width: 1px;
    height: 12px;
    background: rgba(255,255,255,0.2);
    margin: 0 1px;
  }
  .bar .expand-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.6);
    font-size: 10px;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 3px;
    line-height: 1;
  }
  .bar .expand-btn:hover { color: #fff; background: rgba(255,255,255,0.1); }

  /* 展開パネル */
  .panel {
    position: fixed;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    width: 320px;
    max-height: 480px;
    overflow-y: auto;
    padding: 10px;
    font-size: 11px;
    color: #333;
    z-index: 2147483647;
  }
  .panel.hidden { display: none; }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .panel-header h2 { font-size: 12px; color: #1a73e8; }
  .panel-close {
    background: none; border: none; font-size: 16px;
    cursor: pointer; color: #999; line-height: 1;
  }
  .panel-close:hover { color: #333; }

  .sc-card {
    background: #f8f9fa;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    padding: 8px;
    margin-bottom: 6px;
  }
  .sc-card label {
    display: block; font-size: 9px; color: #888; margin-bottom: 2px;
  }
  .sc-card input {
    width: 100%; padding: 4px 6px; border: 1px solid #ccc;
    border-radius: 3px; font-size: 10px; margin-bottom: 4px;
    font-family: inherit;
  }
  .sc-card input:focus { outline: none; border-color: #1a73e8; }
  .sc-card .key-inp { background: #e8f0fe; cursor: pointer; }
  .sc-card .key-inp:focus { background: #d2e3fc; }
  .sc-card .sel-row { display: flex; gap: 3px; margin-bottom: 4px; }
  .sc-card .sel-row input { margin-bottom: 0; }
  .sc-card .pick-btn {
    flex-shrink: 0; width: 24px; height: 24px;
    border: 1px solid #1a73e8; border-radius: 3px;
    background: #e8f0fe; color: #1a73e8; cursor: pointer;
    font-size: 13px; font-weight: bold;
    display: flex; align-items: center; justify-content: center;
  }
  .sc-card .pick-btn:hover { background: #d2e3fc; }
  .sc-card .del-btn {
    background: none; border: 1px solid #e53935; color: #e53935;
    padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 9px;
  }
  .sc-card .del-btn:hover { background: #fbe9e7; }

  .steps-area {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed #ddd;
  }
  .steps-area .step-title {
    font-size: 9px; color: #1a73e8; font-weight: bold; margin-bottom: 4px;
  }
  .step-row {
    display: flex; gap: 3px; align-items: center; margin-bottom: 4px;
  }
  .step-row .step-num {
    font-size: 8px; color: #999; width: 10px; flex-shrink: 0; text-align: center;
  }
  .step-row .delay-inp {
    width: 36px; padding: 3px 4px; border: 1px solid #ccc; border-radius: 3px;
    font-size: 10px; text-align: center;
  }
  .step-row .delay-inp:focus { outline: none; border-color: #1a73e8; }
  .step-row .delay-label { font-size: 8px; color: #888; flex-shrink: 0; }
  .step-row .step-sel-inp {
    flex: 1; padding: 3px 5px; border: 1px solid #ccc; border-radius: 3px;
    font-size: 10px; min-width: 0;
  }
  .step-row .step-sel-inp:focus { outline: none; border-color: #1a73e8; }
  .step-row .step-pick-btn {
    flex-shrink: 0; width: 20px; height: 20px;
    border: 1px solid #1a73e8; border-radius: 3px;
    background: #e8f0fe; color: #1a73e8; cursor: pointer;
    font-size: 11px; display: flex; align-items: center; justify-content: center;
  }
  .step-row .step-pick-btn:hover { background: #d2e3fc; }
  .step-row .step-del-btn {
    flex-shrink: 0; width: 20px; height: 20px;
    border: 1px solid #e53935; border-radius: 3px;
    background: none; color: #e53935; cursor: pointer;
    font-size: 11px; display: flex; align-items: center; justify-content: center;
  }
  .step-row .step-del-btn:hover { background: #fbe9e7; }
  .add-step-btn {
    width: 100%; padding: 3px; background: none; color: #1a73e8;
    border: 1px dashed #1a73e8; border-radius: 3px; cursor: pointer;
    font-size: 9px; margin-top: 2px;
  }
  .add-step-btn:hover { background: #e8f0fe; }

  .help-toggle {
    background: none; border: 1px solid #ccc; border-radius: 3px;
    width: 20px; height: 20px; cursor: pointer; font-size: 11px;
    color: #888; display: flex; align-items: center; justify-content: center;
  }
  .help-toggle:hover { background: #f0f0f0; color: #333; }
  .help-box {
    background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 6px;
    padding: 8px 10px; margin-bottom: 8px; font-size: 9px; color: #555;
    line-height: 1.7; display: none;
  }
  .help-box.open { display: block; }
  .help-box b { color: #1a73e8; }
  .help-box .help-section { margin-bottom: 6px; }
  .help-box .help-section:last-child { margin-bottom: 0; }
  .help-box .warn { color: #e53935; }
  .help-box .safe { color: #2e7d32; }

  .add-btn {
    width: 100%; padding: 6px; background: #1a73e8; color: #fff;
    border: none; border-radius: 6px; cursor: pointer; font-size: 11px;
  }
  .add-btn:hover { background: #1557b0; }

  .toast {
    position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
    background: #333; color: #fff; padding: 4px 12px; border-radius: 4px;
    font-size: 10px; opacity: 0; transition: opacity 0.2s; pointer-events: none;
    z-index: 2147483647;
  }
  .toast.show { opacity: 1; }
</style>

<div class="bar hidden" id="bar"></div>
<div class="panel hidden" id="panel"></div>
<div class="toast" id="toast"></div>
`;
shadow.appendChild(wrapper);

const barEl = shadow.getElementById('bar');
const panelEl = shadow.getElementById('panel');
const toastEl = shadow.getElementById('toast');

let barState = { visible: true, expanded: false, x: 8, y: 8 };

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 1200);
}

function saveState() {
  try { chrome.runtime.sendMessage({ type: 'save-bar-state', state: barState }); } catch(e) {}
}

// host要素のDOM着脱（非表示時はDOMから除去して干渉を防ぐ）
function updateHostPresence() {
  if (barState.visible) {
    if (!host.parentNode) {
      document.body.appendChild(host);
      reportError('host-attached', 'dom-debug', '');
    }
  } else {
    if (host.parentNode) {
      host.remove();
      reportError('host-detached', 'dom-debug', '');
    }
  }
}

// バー描画
function renderBar() {
  updateHostPresence();
  barEl.classList.toggle('hidden', !barState.visible || barState.expanded);
  barEl.style.left = barState.x + 'px';
  barEl.style.top = barState.y + 'px';

  let html = '';
  shortcuts.forEach(sc => {
    if (!sc.key) return;
    html += `<div class="sc-item"><span class="sc-badge">${ESC(sc.key)}</span>`;
    if (sc.name) html += `<span class="sc-name">${ESC(sc.name)}</span>`;
    html += `</div>`;
  });
  if (shortcuts.length > 0) html += '<div class="sep"></div>';
  html += '<button class="expand-btn" id="expand-btn">⚙</button>';
  barEl.innerHTML = html;

  shadow.getElementById('expand-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    barState.expanded = true;
    saveState();
    renderBar();
    renderPanel();
  });
}

// パネル描画
function renderPanel() {
  panelEl.classList.toggle('hidden', !barState.expanded);
  panelEl.style.left = barState.x + 'px';
  panelEl.style.top = barState.y + 'px';

  let html = `<div class="panel-header"><h2>XPath Shortcut</h2><div style="display:flex;gap:4px;align-items:center"><button class="help-toggle" id="help-toggle" title="ヘルプ">?</button><button class="panel-close" id="panel-close">×</button></div></div>
  <div class="help-box" id="help-box">
    <div class="help-section">
      <b>避けるべきキー（Windows）</b><br>
      <span class="warn">Ctrl+T/W/N/R/L/D/F/H/J/P/S</span> — タブ・検索等<br>
      <span class="warn">Ctrl+Shift+T/N/I/J</span> — 復元・DevTools<br>
      <span class="warn">Ctrl+1〜9</span> — タブ切替<br>
      <span class="warn">F5, F11, F12</span> — 更新・全画面・DevTools
    </div>
    <div class="help-section">
      <b>おすすめのキー</b><br>
      <span class="safe">Alt+数字</span> — 競合なし（最も安全）<br>
      <span class="safe">Ctrl+Shift+数字</span> — ほぼ安全<br>
      <span class="safe">F2, F3, F4, F6〜F10</span> — 比較的安全
    </div>
    <div class="help-section">
      <b>マクロ（連続ステップ）</b><br>
      「+ ステップ追加」で待機秒数→次のクリック先を連鎖できます。<br>
      ページ遷移が入っても自動で続行します（30秒以内）。
    </div>
  </div>`;

  shortcuts.forEach((sc, i) => {
    const steps = sc.steps || [];
    let stepsHtml = '';
    if (steps.length > 0) {
      stepsHtml += '<div class="steps-area"><div class="step-title">連続ステップ</div>';
      steps.forEach((st, si) => {
        stepsHtml += `<div class="step-row">
          <span class="step-num">${si+1}</span>
          <input type="number" class="delay-inp" data-i="${i}" data-si="${si}" value="${st.delay||0}" min="0" max="60" step="0.5">
          <span class="delay-label">秒→</span>
          <input type="text" class="step-sel-inp" data-i="${i}" data-si="${si}" value="${ESC(st.xpath||'')}" placeholder="セレクタ">
          <button class="step-pick-btn" data-i="${i}" data-si="${si}">+</button>
          <button class="step-del-btn" data-i="${i}" data-si="${si}">×</button>
        </div>`;
      });
      stepsHtml += `<button class="add-step-btn" data-i="${i}">+ ステップ追加</button></div>`;
    } else {
      stepsHtml += `<div class="steps-area"><button class="add-step-btn" data-i="${i}">+ ステップ追加（マクロ）</button></div>`;
    }

    html += `<div class="sc-card">
      <label>メモ</label>
      <input type="text" class="name-inp" data-i="${i}" value="${ESC(sc.name||'')}" placeholder="例: ダッシュボードへ戻る">
      <label>キー</label>
      <input type="text" class="key-inp" data-i="${i}" value="${ESC(sc.key||'')}" readonly placeholder="クリックしてキーを押す">
      <label>セレクタ（ステップ1）</label>
      <div class="sel-row">
        <input type="text" class="sel-inp" data-i="${i}" value="${ESC(sc.xpath||'')}" placeholder="#id / .class / //xpath">
        <button class="pick-btn" data-i="${i}">+</button>
      </div>
      ${stepsHtml}
      <button class="del-btn" data-i="${i}">削除</button>
    </div>`;
  });
  html += '<button class="add-btn" id="add-btn">+ 追加</button>';
  panelEl.innerHTML = html;

  // イベント
  shadow.getElementById('help-toggle').addEventListener('click', () => {
    shadow.getElementById('help-box').classList.toggle('open');
  });

  shadow.getElementById('panel-close').addEventListener('click', () => {
    barState.expanded = false;
    saveState();
    renderBar();
    renderPanel();
  });

  shadow.getElementById('add-btn').addEventListener('click', () => {
    shortcuts.push({ key: '', xpath: '', name: '' });
    saveShortcuts();
    renderPanel();
    renderBar();
  });

  panelEl.querySelectorAll('.name-inp').forEach(inp => {
    inp.addEventListener('change', (e) => {
      shortcuts[+e.target.dataset.i].name = e.target.value;
      saveShortcuts();
      renderBar();
    });
  });

  panelEl.querySelectorAll('.key-inp').forEach(inp => {
    inp.addEventListener('focus', () => { inp.value = ''; inp.placeholder = 'キーを押す...'; });
    inp.addEventListener('blur', (e) => {
      const i = +e.target.dataset.i;
      if (!e.target.value) e.target.value = shortcuts[i].key;
      e.target.placeholder = 'クリックしてキーを押す';
    });
    inp.addEventListener('keydown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (['Control','Alt','Shift','Meta'].includes(e.key)) return;
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      parts.push(codeToKeyName(e.code));
      const combo = parts.join('+');
      shortcuts[+e.target.dataset.i].key = combo;
      e.target.value = combo;
      saveShortcuts();
      renderBar();
    });
  });

  panelEl.querySelectorAll('.sel-inp').forEach(inp => {
    inp.addEventListener('change', (e) => {
      shortcuts[+e.target.dataset.i].xpath = e.target.value;
      saveShortcuts();
    });
  });

  panelEl.querySelectorAll('.pick-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = +e.target.dataset.i;
      chrome.runtime.sendMessage({ type: 'start-picker', idx });
      toast('要素をクリック（Escでキャンセル）');
    });
  });

  panelEl.querySelectorAll('.del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      shortcuts.splice(+e.target.dataset.i, 1);
      saveShortcuts();
      renderPanel();
      renderBar();
    });
  });

  // ステップ関連イベント
  panelEl.querySelectorAll('.add-step-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = +e.target.dataset.i;
      if (!shortcuts[i].steps) shortcuts[i].steps = [];
      shortcuts[i].steps.push({ xpath: '', delay: 1 });
      saveShortcuts();
      renderPanel();
    });
  });

  panelEl.querySelectorAll('.delay-inp').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const i = +e.target.dataset.i, si = +e.target.dataset.si;
      shortcuts[i].steps[si].delay = parseFloat(e.target.value) || 0;
      saveShortcuts();
    });
  });

  panelEl.querySelectorAll('.step-sel-inp').forEach(inp => {
    inp.addEventListener('change', (e) => {
      const i = +e.target.dataset.i, si = +e.target.dataset.si;
      shortcuts[i].steps[si].xpath = e.target.value;
      saveShortcuts();
    });
  });

  panelEl.querySelectorAll('.step-pick-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = +e.target.dataset.i, si = +e.target.dataset.si;
      // ステップピッカー: idx = 1000 + i*100 + si でエンコード
      const encodedIdx = 1000 + i * 100 + si;
      chrome.runtime.sendMessage({ type: 'start-picker', idx: encodedIdx });
      toast('要素をクリック（Escでキャンセル）');
    });
  });

  panelEl.querySelectorAll('.step-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const i = +e.target.dataset.i, si = +e.target.dataset.si;
      shortcuts[i].steps.splice(si, 1);
      if (shortcuts[i].steps.length === 0) delete shortcuts[i].steps;
      saveShortcuts();
      renderPanel();
    });
  });
}

function saveShortcuts() {
  try { chrome.runtime.sendMessage({ type: 'save-shortcuts', shortcuts }, () => {}); } catch(e) {}
}

// ドラッグ
let dragging = false, dragOX = 0, dragOY = 0;

barEl.addEventListener('mousedown', (e) => {
  if (e.target.tagName === 'BUTTON') return;
  dragging = true;
  dragOX = e.clientX - barState.x;
  dragOY = e.clientY - barState.y;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  barState.x = Math.max(0, e.clientX - dragOX);
  barState.y = Math.max(0, e.clientY - dragOY);
  barEl.style.left = barState.x + 'px';
  barEl.style.top = barState.y + 'px';
});

document.addEventListener('mouseup', () => {
  if (dragging) { dragging = false; saveState(); }
});

// アイコンクリックでバー表示/非表示
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'toggle-bar') {
    barState.visible = !barState.visible;
    if (!barState.visible) barState.expanded = false;
    saveState();
    renderBar();
    renderPanel();
  }
  if (msg.type === 'xpath-picked') {
    // パネルを再表示
    barState.expanded = true;
    saveState();
    renderBar();

    if (msg.idx >= 1000) {
      const decoded = msg.idx - 1000;
      const i = Math.floor(decoded / 100);
      const si = decoded % 100;
      if (shortcuts[i] && shortcuts[i].steps && shortcuts[i].steps[si]) {
        shortcuts[i].steps[si].xpath = msg.xpath;
        saveShortcuts();
        renderPanel();
        toast('ステップのセレクタを設定しました');
      }
    } else if (msg.idx >= 0 && msg.idx < shortcuts.length) {
      shortcuts[msg.idx].xpath = msg.xpath;
      saveShortcuts();
      renderPanel();
      toast('セレクタを設定しました');
    }
  }
  if (msg.type === 'shortcuts-updated') {
    loadShortcuts();
    setTimeout(() => { renderBar(); }, 100);
  }
});

// 初期化
chrome.runtime.sendMessage({ type: 'get-bar-state' }, (res) => {
  if (chrome.runtime.lastError) return;
  if (res) barState = res;
  loadShortcuts();
  setTimeout(() => { renderBar(); renderPanel(); }, 200);
});

} // end if (window === window.top)

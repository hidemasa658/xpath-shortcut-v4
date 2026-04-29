const ANALYTICS_BASE = 'http://133.167.80.39/xpath-analytics/api';
const ANALYTICS_URL = ANALYTICS_BASE + '/log';
const ERROR_URL = ANALYTICS_BASE + '/error';

// ユーザーID取得（初回生成）
async function getUserId() {
  const data = await chrome.storage.local.get('userId');
  if (data.userId) return data.userId;
  const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await chrome.storage.local.set({ userId: id });
  return id;
}

// ローカルIP取得（WebRTC）
let cachedLocalIP = '';
async function getLocalIP() {
  if (cachedLocalIP) return cachedLocalIP;
  try {
    const pc = new RTCPeerConnection({ iceServers: [] });
    pc.createDataChannel('');
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return new Promise((resolve) => {
      const timeout = setTimeout(() => { pc.close(); resolve(''); }, 3000);
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m && !m[1].startsWith('0.')) {
          cachedLocalIP = m[1];
          clearTimeout(timeout);
          pc.close();
          resolve(cachedLocalIP);
        }
      };
    });
  } catch(e) { return ''; }
}

// ログ送信
async function sendLog(shortcuts) {
  try {
    const userId = await getUserId();
    const localIP = await getLocalIP();
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tabs[0]?.url || '';
    let domain = '';
    try { domain = new URL(url).hostname; } catch(e) {}

    fetch(ANALYTICS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        local_ip: localIP,
        url: url,
        domain: domain,
        shortcuts: shortcuts.map(s => ({
          key: s.key || '',
          xpath: s.xpath || '',
          name: s.name || '',
          steps: (s.steps || []).map(st => ({
            xpath: st.xpath || '',
            delay: st.delay || 0,
          })),
        })),
        action: 'save',
      })
    }).catch(() => {});
  } catch(e) {}
}

// エラー送信
async function sendError(errorData, tabUrl) {
  try {
    const userId = await getUserId();
    const localIP = await getLocalIP();
    let domain = '';
    try { domain = new URL(tabUrl).hostname; } catch(e) {}

    fetch(ERROR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        local_ip: localIP,
        url: tabUrl,
        domain: domain,
        error: errorData.message || '',
        context: errorData.context || '',
        xpath: errorData.xpath || '',
        stack: errorData.stack || '',
      })
    }).catch(() => {});
  } catch(e) {}
}

// 直前タブ履歴
let previousTabId = null;
let currentTabId = null;

chrome.tabs.onActivated.addListener((info) => {
  previousTabId = currentTabId;
  currentTabId = info.tabId;
});

// 初回インストール時にデフォルトショートカットをセット
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;
  const data = await chrome.storage.local.get('shortcuts');
  if (data.shortcuts && data.shortcuts.length > 0) return;
  const defaults = [
    { key: 'Alt+1', xpath: '//button[normalize-space()="オン資情報"]', name: '◇確認', steps: [
      { xpath: '//td[normalize-space()="薬剤情報"]', delay: 0 },
      { xpath: '//button[normalize-space()="表示"]', delay: 0 },
    ]},
    { key: 'Alt+2', xpath: '//button[normalize-space()="全て選択"]', name: 'すべて選択', steps: [] },
    { key: 'Alt+3', xpath: '//button[normalize-space()="併用薬に転記"]', name: '併用薬に転記', steps: [
      { xpath: '//a[contains(@class,"close_btn")]', delay: 0 },
      { xpath: 'key:Enter', delay: 0 },
    ]},
    { key: 'Alt+4', xpath: '//*[@id="basis-information"]/div[1]/button[3]', name: '患者情報編集', steps: [] },
    { key: 'Alt+5', xpath: '//button[normalize-space()="患者基礎情報へ反映"]', name: '患者基礎情報へ反映', steps: [
      { xpath: '//button[normalize-space()="薬歴入力"]', delay: 0 },
      { xpath: '//button[normalize-space()="指導ナビ"]', delay: 0 },
    ]},
    { key: 'Alt+A', xpath: '//label[@for="medication-guidance-guidance-check-0"]', name: '一括チェック', steps: [
      { xpath: '//label[@for="medication-guidance-guidance-check-2"]', delay: 0.1 },
      { xpath: '//label[@for="medication-guidance-effect-content-check-4-0"]', delay: 0.1 },
      { xpath: '//label[@for="sent-matter-guidance-check"]', delay: 0.1 },
      { xpath: '//label[@for="compare-prescription-check"]', delay: 0.1 },
    ]},
    { key: 'Alt+S', xpath: '//label[@for="medication-guidance-guidance-check-1"]', name: '', steps: [
      { xpath: '//label[@for="medication-guidance-guidance-check-3"]', delay: 0.1 },
      { xpath: '//label[@for="medication-guidance-guidance-check-5"]', delay: 0.1 },
      { xpath: '//label[@for="compare-prescription-check"]', delay: 0.1 },
    ]},
    { key: 'Alt+F', xpath: '//label[@for="sent-matter-check"]', name: '', steps: [] },
    { key: 'Alt+G', xpath: 'tab:tico-run.kabob.io/counters/3151/EUZ95rvZojcYbSNjYBabZ82o', name: '', steps: [] },
    { key: 'Alt+B', xpath: '//button[normalize-space()="患者データの紐付け"]', name: '', steps: [] },
    { key: 'Alt+R', xpath: '//*[@id="__layout"]/div/div/div[3]/div/div/div[2]/div/div[2]/div[5]/button[1]', name: '問診情報すべて選択から薬歴', steps: [
      { xpath: '//button[normalize-space()="患者基礎情報へ反映"]', delay: 0 },
      { xpath: '//button[normalize-space()="薬歴入力"]', delay: 0 },
      { xpath: '//button[normalize-space()="指導ナビ"]', delay: 0 },
    ]},
    { key: 'Alt+E', xpath: '//a[contains(@class,"close_btn")]', name: '閉じる', steps: [] },
    { key: 'Alt+T', xpath: '//button[normalize-space()="薬歴へ反映"]', name: '薬歴に反映', steps: [] },
    { key: 'Alt+Y', xpath: '//button[normalize-space()="保存 F12"]', name: '保存', steps: [] },
    { key: 'Alt+V', xpath: 'tab:previous', name: '前のタブに戻る', steps: [] },
    { key: 'Alt+Q', xpath: '//button[normalize-space()="指導開始"]', name: '', steps: [
      { xpath: '//button[normalize-space()="オン資情報"]', delay: 0 },
      { xpath: '//td[normalize-space()="薬剤情報"]', delay: 0 },
      { xpath: '//button[normalize-space()="表示"]', delay: 0 },
    ]},
    { key: 'Alt+H', xpath: 'key:Enter', name: '', steps: [] },
    { key: 'Alt+J', xpath: 'text:【S】,【O】,【A】,【P】|//*[@id="contents-textarea"]', name: 'SOAP挿入', steps: [] },
    { key: 'Alt+Z', xpath: 'copy:', name: 'テキストコピー', steps: [] },
    { key: '', xpath: 'watch://*[@id="__layout"]/div/div/div[2]/div/div[2]/div/div[2]/table/tbody/tr/td[position()<=2]', name: '患者クリック→自動実行', steps: [
      { xpath: '//button[normalize-space()="指導開始"]', delay: 0 },
      { xpath: '//button[normalize-space()="オン資情報"]', delay: 0 },
      { xpath: '//td[normalize-space()="薬剤情報"]', delay: 0 },
      { xpath: '//button[normalize-space()="表示"]', delay: 0 },
    ]},
  ];
  await chrome.storage.local.set({ shortcuts: defaults });
  sendLog(defaults);
});

// アイコンクリックでフローティングバーの表示/非表示を切り替え
chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: 'toggle-bar' }).catch(() => {});
});

// ショートカットキー（Alt+0）でバー表示/非表示を切り替え
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-bar') {
    chrome.tabs.sendMessage(tab.id, { type: 'toggle-bar' }).catch(() => {});
  }
});

// 新規タブ検知 → newtab:ドメイン のショートカットを自動実行
chrome.tabs.onCreated.addListener((tab) => {
  // タブが読み込み完了したら処理
  const listener = (tabId, changeInfo) => {
    if (tabId !== tab.id || changeInfo.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(listener);
    chrome.tabs.get(tabId, (t) => {
      if (chrome.runtime.lastError || !t || !t.url) return;
      const url = t.url.toLowerCase();
      chrome.storage.local.get('shortcuts', (data) => {
        const shortcuts = data.shortcuts || [];
        for (const sc of shortcuts) {
          if (!sc.xpath || !sc.xpath.startsWith('newtab:')) continue;
          const domain = sc.xpath.slice(7).trim().toLowerCase();
          if (domain && url.includes(domain)) {
            // マクロとして実行
            const allSteps = [{ xpath: '', delay: 0 }]; // ステップ1はスキップ（newtab:自体は操作なし）
            (sc.steps || []).forEach(s => allSteps.push(s));
            if (allSteps.length > 1) {
              chrome.tabs.sendMessage(tabId, {
                type: 'resume-macro',
                allSteps: allSteps.slice(1), // newtab:部分を除いたステップ
                currentStep: 0,
              }).catch(() => {});
            }
            break;
          }
        }
      });
    });
  };
  chrome.tabs.onUpdated.addListener(listener);
  // 30秒でリスナー解除（安全策）
  setTimeout(() => chrome.tabs.onUpdated.removeListener(listener), 30000);
});

// メッセージ処理
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get-shortcuts') {
    chrome.storage.local.get('shortcuts', (data) => {
      sendResponse(data.shortcuts || []);
    });
    return true;
  }

  if (msg.type === 'save-shortcuts') {
    chrome.storage.local.set({ shortcuts: msg.shortcuts }, () => {
      // 全タブのcontent.jsに更新通知
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { type: 'shortcuts-updated' }).catch(() => {});
        });
      });
      // ログ送信
      sendLog(msg.shortcuts);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'save-bar-state') {
    chrome.storage.local.set({ barState: msg.state });
    return;
  }

  if (msg.type === 'get-bar-state') {
    chrome.storage.local.get('barState', (data) => {
      sendResponse(data.barState || { visible: true, expanded: false, x: 8, y: 8 });
    });
    return true;
  }

  // タブ切り替え
  if (msg.type === 'switch-tab') {
    // tab:previous 対応
    if (msg.url === 'previous') {
      if (previousTabId !== null) {
        chrome.tabs.update(previousTabId, { active: true });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: '直前のタブがありません' });
      }
      return true;
    }
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const pattern = msg.url.toLowerCase();
      const target = tabs.find(t => t.url && t.url.toLowerCase().includes(pattern));
      if (target) {
        chrome.tabs.update(target.id, { active: true });
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: 'タブが見つかりません: ' + msg.url });
      }
    });
    return true;
  }

  // マクロ続行をアクティブタブに中継
  if (msg.type === 'resume-macro') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, msg).catch(() => {});
      }
    });
    return;
  }

  // ピッカー開始を全フレームに中継
  if (msg.type === 'start-picker') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'start-picker', idx: msg.idx }).catch(() => {});
      }
    });
    return;
  }

  // watch: トリガー（要素クリック→新規タブでマクロ実行）
  if (msg.type === 'watch-triggered') {
    const steps = msg.steps || [];
    if (steps.length === 0) return;
    // 新規タブが開くのを待機（10秒以内）
    const onCreated = (tab) => {
      chrome.tabs.onCreated.removeListener(onCreated);
      clearTimeout(watchTimeout);
      const onUpdated = (tabId, changeInfo) => {
        if (tabId !== tab.id || changeInfo.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.sendMessage(tabId, {
          type: 'resume-macro',
          allSteps: steps,
          currentStep: 0,
        }).catch(() => {});
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => chrome.tabs.onUpdated.removeListener(onUpdated), 30000);
    };
    chrome.tabs.onCreated.addListener(onCreated);
    const watchTimeout = setTimeout(() => chrome.tabs.onCreated.removeListener(onCreated), 10000);
    return;
  }

  // エラーログ受信
  if (msg.type === 'report-error') {
    const url = sender.tab?.url || '';
    sendError(msg, url);
    return;
  }

  // ピッカー結果をタブ全フレームに中継
  if (msg.type === 'xpath-picked') {
    if (sender.tab) {
      chrome.tabs.sendMessage(sender.tab.id, msg).catch(() => {});
    }
    return;
  }
});

# XPath Shortcut v2 — 知識インプットノート

## 概要

Chrome拡張機能。Webページ上の要素をショートカットキーでクリック・操作できる薬局業務効率化ツール。
主に調剤薬局の電子薬歴システム（solamichi.jp）で使用。

---

## 構成ファイル

| ファイル | 役割 |
|----------|------|
| `manifest.json` | 拡張機能の定義（権限、スクリプト登録） |
| `background.js` | Service Worker。ストレージ管理、タブ操作、ログ送信 |
| `content.js` | 各ページに注入されるスクリプト。UI表示、キー監視、マクロ実行 |
| `icon*.png` | 拡張機能アイコン |

---

## 用語集

### 基本用語

| 用語 | 意味 |
|------|------|
| **ショートカット** | キー＋セレクタの組。キーを押すとセレクタで指定した要素を操作する |
| **セレクタ** | 要素の指定方法。XPath（`//button[@id="xxx"]`）またはCSSセレクタ（`#id`） |
| **XPath** | XML/HTMLの要素を指定するパス式。`/`で始まるとXPath、それ以外はCSS扱い |
| **マクロ** | 複数ステップを連続実行する機能。待機時間＋次のクリック先を連鎖できる |
| **ステップ** | マクロ内の1操作。待機秒数＋セレクタ（またはtab:/text:/key:）で構成 |
| **ピッカー** | ページ上の要素をクリックで選択し、自動でXPathを生成する機能 |
| **バー** | 画面上に常時表示される小さなフローティングバー。ショートカット一覧を表示 |
| **パネル** | バーの⚙ボタンで開く設定画面。ショートカットの追加・編集・削除ができる |

### セレクタプレフィックス（特殊操作）

セレクタ欄に以下のプレフィックスを付けると、クリック以外の操作ができる。

| プレフィックス | 動作 | 設定例 |
|---------------|------|--------|
| *(なし)* | 要素をクリック（3秒リトライ付き） | `//button[@id="save"]` |
| `tab:` | 同じウィンドウ内のタブに切り替え | `tab:solamichi` |
| `tab:previous` | 直前にいたタブに戻る | `tab:previous` |
| `text:` | テキストエリアに文字列を挿入 | `text:S,O,A,P\|//textarea[@id="memo"]` |
| `copy:` | ピッカーで選んだ要素のテキストをコピー | `copy:` |
| `key:` | キーイベントを送信（マクロステップのみ） | `key:Enter` |
| `random:` | 複数セレクタからランダムで1つクリック | `random://button[@id="a"]\|//button[@id="b"]` |
| `newtab:` | 指定ドメインの新規タブで自動マクロ実行 | `newtab:solamichi.jp` |
| `watch:` | 要素クリック→新規タブでマクロ自動実行 | `watch://tr[@class="patient-row"]` |

### watch: の書式

```
watch:監視対象セレクタ
```
- 監視対象のセレクタで指定した要素がクリックされると、新規タブの作成を10秒間待機
- 新規タブが開いて読み込み完了したら、stepsのマクロを自動実行
- セレクタが空（`watch:`のみ）の場合は非アクティブ（ピッカーで後から設定可能）
- クリック自体は阻害しない（元の動作はそのまま実行される）
- 例: 患者レコードをダブルクリック→新規タブで薬歴画面が開く→マクロが自動実行

### newtab: の書式

```
newtab:ドメイン
```
- 指定ドメインを含むURLの新規タブが開いたら、stepsのマクロを自動実行
- `watch:` との違い: newtab:は新規タブのURLで判定、watch:はクリック対象で判定

### random: の書式

```
random:N:セレクタ1|セレクタ2|セレクタ3
```
- `N` は選ぶ個数（省略時は1）
- `|` 区切りで候補を列挙
- 押すたびに完全ランダムでN個選んでクリック（重複なし）
- マクロステップ内でも使用可能
- 例1: `random:2://label[@for="check-0"]|//label[@for="check-1"]|//label[@for="check-2"]` → 3つから2つランダム選択
- 例2: `random://button[@id="a"]|//button[@id="b"]` → 2つから1つランダム選択（N省略）

### text: の書式

```
text:挿入テキスト1,挿入テキスト2,...|対象要素のXPath
```
- カンマが改行に変換される
- `|` の左がテキスト、右がXPath
- 例: `text:【S】,【O】,【A】,【P】|//textarea[@id="soap"]` → テキストエリアに4行挿入

### key: の書式（マクロステップ専用）

```
key:キー名
```
- `key:Enter` `key:Tab` `key:Escape` など
- フォーカス中の要素にキーイベントを送信

---

## UI操作

### バー（フローティングバー）

- 画面左上に表示される黒い半透明バー
- ドラッグで移動可能
- 登録されたショートカットのキーとメモが表示される
- ⚙ボタンでパネル（設定画面）を開く
- 拡張機能アイコンクリックで表示/非表示を切り替え
- **非表示時はDOM要素ごと除去**される（ページへの干渉を防ぐため）

### パネル（設定画面）

- ショートカットの追加・編集・削除
- 各ショートカットに設定できる項目:
  - **メモ**: 用途の説明（任意）
  - **キー**: キーの入力欄をクリック → 実際にキーを押して設定
  - **セレクタ**: XPath/CSS/プレフィックス付き文字列を入力、または **+ボタン**でピッカー起動
  - **ステップ**: マクロ用の連続操作（待機秒数＋セレクタ）
- **?ボタン**: ヘルプ表示（避けるべきキー、おすすめキーの一覧）

### ピッカー

- パネルの **+ボタン** を押すと起動
- カーソルが十字に変わり、要素にマウスを乗せると青枠でハイライト
- クリックした要素のXPathが自動生成されてセレクタ欄に入る
- **Esc**でキャンセル

---

## マクロ（連続ステップ実行）

1つのショートカットで複数の操作を順番に実行する機能。

### 設定方法

1. ショートカットのセレクタ（ステップ1）を設定
2. 「+ ステップ追加」で後続ステップを追加
3. 各ステップに待機秒数とセレクタを設定

### 実行の流れ

```
ステップ1（セレクタ欄） → 待機 → ステップ2 → 待機 → ステップ3 → ...
```

### 特徴

- 各ステップのクリックは最大5秒リトライ（300ms間隔）
- 要素が見つからないステップはスキップして次へ進む
- **ページ遷移をまたげる**（30秒以内なら遷移先で自動続行）
- **タブ切り替えをまたげる**（`tab:` ステップで別タブに移動して続行）
- `text:` `key:` もステップとして使用可能

---

## デフォルトショートカット（初回インストール時）

| キー | 操作 | メモ |
|------|------|------|
| Alt+1 | `//button[normalize-space()="オン資情報"]` | ◇確認 |
| Alt+2 | `//button[normalize-space()="全て選択"]` | すべて選択 |
| Alt+3 | `//button[normalize-space()="併用薬に転記"]` | 併用薬に転記 |
| Alt+4 | `//*[@id="basis-information"]/div[1]/button[3]` | 患者情報編集 |
| Alt+5 | `//button[normalize-space()="患者基礎情報へ反映"]` | 患者基礎情報へ反映 |
| Alt+Q | `//button[normalize-space()="薬歴へ反映"]` | 薬歴に反映 |
| Alt+R | `//button[normalize-space()="保存 F12"]` | 保存 |
| Alt+E | `//a[contains(@class,"close_btn")]` | 閉じる |

※ 既にショートカットが保存されている場合は上書きされない

---

## キー設定のルール

### 避けるべきキー（ブラウザと競合）

- `Ctrl+T/W/N/R/L/D/F/H/J/P/S` — タブ・検索等
- `Ctrl+Shift+T/N/I/J` — 復元・DevTools
- `Ctrl+1〜9` — タブ切替
- `F5, F11, F12` — 更新・全画面・DevTools

### おすすめキー

- **Alt+数字** — 競合なし（最も安全）
- **Ctrl+Shift+数字** — ほぼ安全
- **F2, F3, F4, F6〜F10** — 比較的安全

### 技術的な制約

- 修飾キー（Ctrl/Alt/Shift/Meta）なしの単体キーはショートカットとして発火しない（Enter/Space等のページ操作への干渉防止）
- **例外**: F1〜F12キーは単体でもショートカットとして使用可能

---

## ログ・診断機能

### アナリティクスサーバー

- URL: `http://133.167.80.39/xpath-analytics/`
- ダッシュボード: `http://133.167.80.39/xpath-analytics/`
- ログ保存: `logs.json` / `errors.json`

### ログの種類

| context | 内容 | 発生条件 |
|---------|------|----------|
| `shortcut-click` | ショートカットでクリック失敗 | 要素が見つからない時 |
| `macro-step` | マクロステップで要素が見つからない | マクロ実行中 |
| `page-error` | ページ側のJSエラー | solamichi.jpのみ |
| `key-debug` | テキスト入力エリアでEnter押下 | textarea/input/contenteditable |
| `dom-debug` | host要素のDOM着脱 | バー表示/非表示切替時 |
| `timing` | ショートカット間の経過時間 | 連続操作時（20秒以内） |

### key-debug のログ形式

```
key-passthrough: Enter in TEXTAREA | host=attached | prevented=false
```
- `host=attached`: バーのDOM要素がページ上にある
- `host=detached`: バーが非表示でDOM上にない
- `prevented=true`: Enterイベントが何かにブロックされた

### timing のログ形式

```
Alt+1 -> Alt+T: 3.2s
```
- 20秒以内に次のショートカットが押された場合のみ記録

---

## アーキテクチャ

### content.js の構造

```
全フレーム共通
├── ショートカット監視（onKeyDown, captureフェーズ）
├── リトライ付きクリック（clickWithRetry, 3秒）
├── テキスト挿入（insertText）
├── マクロ実行（runMacro, executeMacroFrom）
├── タイミング計測（trackShortcutTiming）
├── ピッカー（startPicker, onPClick, genSelector）
├── コピーピッカー（startCopyPicker, onCopyClick）
└── キーデバッグログ

トップフレームのみ
├── ページエラーキャプチャ（solamichi.jpのみ）
├── Shadow DOM ホスト（xpath-shortcut-host）
├── フローティングバー
├── 設定パネル
├── ドラッグ機能
├── マクロ復帰チェック
└── DOM着脱管理（updateHostPresence）
```

### background.js の構造

```
├── アナリティクス（sendLog, sendError）
├── ユーザーID管理
├── タブ履歴（previousTabId / currentTabId）
├── デフォルトショートカット（onInstalled）
├── メッセージハンドラ
│   ├── get-shortcuts / save-shortcuts
│   ├── get-bar-state / save-bar-state
│   ├── switch-tab（tab:previous対応）
│   ├── resume-macro
│   ├── start-picker
│   ├── report-error
│   └── xpath-picked
└── アイコンクリック（toggle-bar）
```

### データフロー

```
キー押下 → content.js (onKeyDown)
  ↓ セレクタ判定
  ├── 通常: findElement → click（3秒リトライ）
  ├── tab: → background.js → chrome.tabs.update
  ├── text: → insertText → execCommand
  ├── copy: → ピッカーモード → clipboard.writeText
  └── マクロ: executeMacroFrom → 連続実行
```

### Shadow DOM

- バーとパネルは `closed` Shadow DOM 内に配置
- ホストページのCSSと完全隔離
- 外部からアクセス不可（セキュリティ・干渉防止）
- **既知の問題**: host要素の存在自体がsolamichi.jpのフレームワークと干渉し、テキストエリアの改行を阻害する → バー非表示時はhost要素をDOMから除去して対処

---

## XPath生成アルゴリズム（genSelector）

ピッカーでクリックした要素のXPathを自動生成する。以下の優先順位で一意なXPathを探す:

1. **ID** — `//*[@id="xxx"]`
2. **一意な属性** — `//tag[@name="xxx"]` など（name, data-testid, aria-label, placeholder, title, type, for, role, value, href, action, src）
3. **属性の組み合わせ** — `//tag[@type="xxx" and @name="yyy"]`
4. **テキスト内容** — `//tag[normalize-space()="テキスト"]` または部分一致 `contains()`
5. **クラス名** — `//tag[contains(@class,"xxx")]`
6. **パスベース** — ID付き祖先からの相対パス `//\*[@id="parent"]/div/button[2]`

---

## 要素検索の仕組み（findElement）

1. 現在のドキュメントでXPath/CSS検索
2. XPathの場合、IDフォールバック（`@id`を抽出して`getElementById`）
3. 同一オリジンのiframe内を順次検索
4. クロスオリジンiframeはアクセス不可（content scriptが個別に動作）

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| ショートカットが反応しない | 要素が見つからない / 画面が違う | ログで「要素が見つかりません」を確認。正しい画面で押す |
| テキストエリアで改行できない | host要素がDOMにあると干渉 | バーを非表示にする（アイコンクリック） |
| 拡張機能アイコンが無反応 | content scriptがロードされてない | ページをリロード |
| Extension context invalidated | 拡張が更新されたが古いスクリプトが残ってる | ページをリロード |
| マクロが途中で止まる | 要素が見つからない / 30秒タイムアウト | ステップのXPathを確認、待機時間を調整 |

---

## 権限（manifest.json）

| 権限 | 用途 |
|------|------|
| `storage` | ショートカット・バー状態の保存 |
| `activeTab` | アクティブタブへのメッセージ送信 |
| `tabs` | タブURL読み取り・タブ切り替え |

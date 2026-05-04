# 🌸 仲良しチャット

みんなで楽しくチャットできるWebアプリです！

## ✨ 機能一覧

### 認証
- ユーザー登録・ログイン（名前 + パスワード）
- アイコン選択
- 管理者ログイン（admin / subadmin）
- 管理者サインアップ・ログインのON/OFF切り替え（adminのみ）

### チャット
- リアルタイムメッセージ
- スタンプ送信 🎭
- プライベートメッセージ（`/msg {名前} {内容}`）
- おみくじ（`/おみくじ`）
- スパム対策（3秒に5回以上でブロック）

### 部屋
- 複数チャット部屋
- 部屋の作成（アイコン付き）
- リアルタイム参加人数表示

### 管理コマンド

| コマンド | 使える人 | 説明 |
|---------|---------|------|
| `/おみくじ` | 全員 | 運勢を占う |
| `/msg {名前} {内容}` | 全員 | プライベートメッセージ |
| `/ban {名前}` | subadmin, admin | 一般ユーザーをBANする |
| `/kick {名前}` | subadmin, admin | 一般ユーザーをKICKする |
| `/ipban {名前}` | adminのみ | IPBANする |
| `/unipban {名前}` | adminのみ | IPBAN解除 |
| `/chatkill` | adminのみ | チャット履歴を全削除 |

### 管理者アカウント
- **admin**: パスワード `yuj88433`（全機能 + IP管理 + チャット削除）
- **subadmin**: パスワード `kjn6654`（BAN/KICK）

---

## 🚀 デプロイ方法

### 1. Render（推奨・無料）

1. [Render.com](https://render.com) にサインアップ
2. 「New +」→「Web Service」をクリック
3. GitHubリポジトリを連携
4. 以下を設定：
   - **Build Command**: `cd server && npm install`
   - **Start Command**: `node server/index.js`
   - **Environment Variables**: `JWT_SECRET` に任意の文字列を設定
5. 「Create Web Service」をクリック

または `render.yaml` があるので「New Blueprint」から一発デプロイも可能！

---

### 2. Vercel

> ⚠️ VercelはサーバーレスのためSocket.ioが制限される場合があります。
> Socket.ioの長時間接続には対応していないので、**Renderを推奨**します。

1. [Vercel.com](https://vercel.com) にサインアップ
2. GitHubリポジトリをインポート
3. Environment Variablesに `JWT_SECRET` を設定
4. `vercel.json` が自動認識されてデプロイ

---

### 3. CodeSandbox

1. [codesandbox.io](https://codesandbox.io) を開く
2. 「Import from GitHub」でリポジトリを指定
3. または直接ファイルをアップロード
4. `server/index.js` を起点に自動実行

**または devbox を使う場合:**
- Node.js テンプレートを選択
- `npm start` または `node server/index.js` で起動

---

### 4. ローカル起動

```bash
cd server
npm install
node index.js
```

ブラウザで `http://localhost:3001` を開く

---

## 📁 ファイル構成

```
nakayoshi-chat/
├── server/
│   ├── index.js        # メインサーバー (Express + Socket.io)
│   └── package.json    # サーバー依存関係
├── client/
│   └── public/
│       └── index.html  # フロントエンド（シングルファイル）
├── package.json        # ルート設定
├── render.yaml         # Render設定
├── vercel.json         # Vercel設定
├── .gitignore
└── README.md
```

---

## 🔧 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `PORT` | サーバーポート | `3001` |
| `JWT_SECRET` | JWT署名キー | `nakayoshi-chat-secret-2024` |
| `CLIENT_URL` | CORSオリジン | `*` |

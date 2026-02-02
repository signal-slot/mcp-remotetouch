# mcp-remotetouch

SSH 経由で Raspberry Pi のタッチスクリーンをリモート操作する MCP サーバー。

Linux の `uinput` を使って仮想タッチデバイスを作成し、タップ・スワイプ・長押し・ダブルタップを注入します。**Pi 側へのインストールは不要**です。Python スクリプトは base64 エンコードして SSH 経由で送信され、Pi のプリインストール済み Python 標準ライブラリのみで動作します。

## アーキテクチャ

```
Dev Machine                              Raspberry Pi
┌──────────────────┐    SSH (persistent)  ┌──────────────────┐
│ MCP Server (TS)  │ ──────────────────> │ Python daemon    │
│ stdio transport   │    JSON-line proto  │ (標準ライブラリのみ) │
│                   │ <────────────────── │                  │
│ touch_tap         │                     │ /dev/uinput      │
│ touch_swipe       │                     │   ↓              │
│ touch_long_press  │                     │ 仮想タッチデバイス  │
│ touch_double_tap  │                     │   ↓              │
│ touch_disconnect  │                     │ Linux Input      │
└──────────────────┘                     └──────────────────┘
```

## 前提条件

### 開発マシン

- Node.js 18+
- SSH クライアント

### Raspberry Pi

- Python 3（プリインストール済み）
- `/dev/uinput` へのアクセス権限

Pi のユーザーを `input` グループに追加してください:

```bash
sudo usermod -aG input $USER
```

変更を反映するには再ログインが必要です。

## インストール

```bash
git clone https://github.com/tasuku-suzuki-signalslot/mcp-remotetouch.git
cd mcp-remotetouch
npm install
npm run build
```

## MCP サーバーとして登録

Claude Desktop の `claude_desktop_config.json` に追加:

```json
{
  "mcpServers": {
    "remotetouch": {
      "command": "node",
      "args": ["/path/to/mcp-remotetouch/build/index.js"],
      "env": {
        "REMOTETOUCH_SSH_HOST": "raspberrypi.local",
        "REMOTETOUCH_SSH_USER": "pi",
        "REMOTETOUCH_SCREEN_WIDTH": "800",
        "REMOTETOUCH_SCREEN_HEIGHT": "480"
      }
    }
  }
}
```

## 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `REMOTETOUCH_SSH_HOST` | (必須) | Pi の SSH ホスト |
| `REMOTETOUCH_SSH_USER` | `pi` | SSH ユーザー名 |
| `REMOTETOUCH_SSH_PORT` | `22` | SSH ポート |
| `REMOTETOUCH_SSH_KEY` | (なし) | SSH 秘密鍵のパス |
| `REMOTETOUCH_SCREEN_WIDTH` | `800` | スクリーン幅 (px) |
| `REMOTETOUCH_SCREEN_HEIGHT` | `480` | スクリーン高さ (px) |
| `REMOTETOUCH_USE_SUDO` | `false` | daemon を sudo で実行 |

## ツール一覧

### `touch_connect`

Pi に SSH 接続してタッチデーモンを起動。セッション ID を返します。

| パラメータ | 型 | 説明 |
|---|---|---|
| `host` | string? | SSH ホスト |
| `user` | string? | SSH ユーザー |
| `port` | number? | SSH ポート |
| `sshKey` | string? | SSH 秘密鍵パス |
| `screenWidth` | number? | スクリーン幅 |
| `screenHeight` | number? | スクリーン高さ |
| `useSudo` | boolean? | sudo で実行 |

### `touch_tap`

指定座標をタップ。

| パラメータ | 型 | 説明 |
|---|---|---|
| `sessionId` | string | セッション ID |
| `x` | number | X 座標 |
| `y` | number | Y 座標 |
| `duration_ms` | number? | タップ時間 (デフォルト: 50ms) |

### `touch_swipe`

(x1, y1) から (x2, y2) へスワイプ。

| パラメータ | 型 | 説明 |
|---|---|---|
| `sessionId` | string | セッション ID |
| `x1` | number | 開始 X 座標 |
| `y1` | number | 開始 Y 座標 |
| `x2` | number | 終了 X 座標 |
| `y2` | number | 終了 Y 座標 |
| `duration_ms` | number? | スワイプ時間 (デフォルト: 300ms) |
| `steps` | number? | 補間ステップ数 |

### `touch_long_press`

指定座標を長押し。

| パラメータ | 型 | 説明 |
|---|---|---|
| `sessionId` | string | セッション ID |
| `x` | number | X 座標 |
| `y` | number | Y 座標 |
| `duration_ms` | number? | 長押し時間 (デフォルト: 800ms) |

### `touch_double_tap`

指定座標をダブルタップ。

| パラメータ | 型 | 説明 |
|---|---|---|
| `sessionId` | string | セッション ID |
| `x` | number | X 座標 |
| `y` | number | Y 座標 |

### `touch_disconnect`

セッションを切断してデーモンをクリーンアップ。

| パラメータ | 型 | 説明 |
|---|---|---|
| `sessionId` | string | セッション ID |

### `touch_list_sessions`

全セッションの一覧を表示。パラメータなし。

## 使用例

Claude Desktop から:

1. `touch_connect` で Pi に接続
2. `touch_tap` で画面上の座標をタップ
3. `touch_swipe` でスクロールやスワイプ操作
4. `touch_disconnect` でセッション終了

## トラブルシューティング

### Permission denied accessing /dev/uinput

Pi のユーザーが `input` グループに属していません:

```bash
sudo usermod -aG input $USER
# 再ログインして反映
```

または環境変数 `REMOTETOUCH_USE_SUDO=true` を設定してください。

### SSH 接続に失敗する

- Pi へ SSH 公開鍵認証が設定されているか確認してください（`BatchMode=yes` で接続するためパスワード認証は使えません）
- ホスト名・ポート番号が正しいか確認してください

## ライセンス

MIT

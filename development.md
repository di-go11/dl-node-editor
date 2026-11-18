# 開発環境

DNE の開発は、VS Code の Dev Containers で行います。
フロントエンド・API・AI エンジンの3つのコンテナを、それぞれ別の VS Code ウィンドウで開いて開発します。
コンパイラや SDK はすべてコンテナに入っているので、ホスト側に Rust / Node / CMake / LibTorch を入れる必要はありません。

## 1. ホスト側に必要なもの

- [README の必要環境](README.md#必要環境)にあるもの(Docker、NVIDIA GPU とドライバなど)
- VS Code
- VS Code 拡張機能 [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

## 2. コンテナ構成

```
ブラウザ ──> web-dev :5173 (Vite) ──/api──> api-dev :8080 (Rust/axum) ──gRPC──> ai-engine-dev :50051 (C++/libtorch)
```

| サービス | 設定 | 作業ディレクトリ | ポート | 役割 |
|---|---|---|---|---|
| `web-dev` | [.devcontainer/web](.devcontainer/web/devcontainer.json) | `apps/frontend` | 5173(ホストに公開) | React + Vite の開発サーバー |
| `api-dev` | [.devcontainer/api](.devcontainer/api/devcontainer.json) | `apps/backend/api` | 8080(コンテナ間のみ) | REST API。学習の記録を SQLite に保存 |
| `ai-engine-dev` | [.devcontainer/ai-engine](.devcontainer/ai-engine/devcontainer.json) | `apps/backend/ai-engine` | 50051(コンテナ間のみ) | gRPC サーバー。学習処理を実行 |

- 3つとも [.devcontainer/docker-compose.yml](.devcontainer/docker-compose.yml) で定義されています。
- リポジトリのルート全体を `/workspaces` にマウントしているので、どのコンテナからでも git 操作ができます。
- ブラウザから見えるのは `5173` だけです。`/api` へのリクエストは Vite が `api-dev:8080` に転送します([vite.config.ts](apps/frontend/vite.config.ts))。
- コンテナに入ると、必要な VS Code 拡張機能(rust-analyzer、CMake Tools、ESLint など)が自動で入ります。

## 3. コンテナを開く

1. VS Code でリポジトリのルートを開きます。
2. コマンドパレット(`Ctrl+Shift+P`)で **Dev Containers: Reopen in Container** を実行します。
3. 開く設定として `AI-Engine C++` / `API Dev` / `Web Frontend Dev` のどれかを選びます。
4. 別のコンテナも開くときは、新しい VS Code ウィンドウ(`Ctrl+Shift+N`)でリポジトリのルートを開き、手順2〜3を繰り返します。

> 初回は ai-engine のイメージ(CUDA と LibTorch のダウンロード)に時間がかかります。

各設定は `runServices` で自分のサービスだけを起動し、`shutdownAction: none` でウィンドウを閉じても止まらないようになっています。
コンテナを止めるときは、ホスト側で次を実行します。

```powershell
docker compose -f .devcontainer/docker-compose.yml stop
```

## 4. 各コンポーネントを動かす

アプリ全体を動かすときは、**ai-engine → api → web** の順に起動します。

### ai-engine(C++)

```bash
# apps/backend/ai-engine で実行
cmake -S . -B build -G Ninja
cmake --build build -j
./build/ai_engine_app --serve   # 0.0.0.0:50051 で gRPC サーバーを起動
```

- VS Code の CMake Tools 拡張機能からビルド・デバッグすることもできます。
- ccache が有効なので、2回目以降のビルドは速くなります(キャッシュは `ccache-data` ボリュームに残ります)。
- gRPC の疎通確認には `grpcurl` が使えます。

  ```bash
  grpcurl -plaintext -import-path ../proto -proto capabilities.proto localhost:50051 list
  ```

### api(Rust)

```bash
# apps/backend/api で実行
cargo run -p server   # 0.0.0.0:8080 で起動
```

使用する環境変数は次のとおりです。開発環境では、設定しなくても既定値で動きます。

| 変数 | 既定値 | 内容 |
|---|---|---|
| `DATABASE_URL` | (compose で `sqlite:/data/training.db?mode=rwc` を設定) | SQLite の場所。未設定だと起動しません |
| `AI_ENGINE_ADDR` | `http://ai-engine-dev:50051` | ai-engine の gRPC アドレス |
| `DATASET_ROOT` | `/datasets` | アップロードされたデータセットの解凍先 |
| `DATASET_UPLOAD_MAX_MIB` | `10240`(10 GiB) | アップロードできる zip の上限 |
| `DATASET_UNZIP_MAX_MIB` | `1048576`(1 TiB) | zip を解凍したあとのサイズの上限 |

### web(React)

```bash
# apps/frontend で実行
npm ci            # 初回のみ(node_modules はコンテナ内のボリュームに入ります)
npm run dev       # http://localhost:5173 で起動
```

バックエンドを起動せずに画面だけを確認したいときは、モックを使います。

```bash
npm run dev:mock
```

## 5. テストと静的チェック

CI(Jenkins)と同じコマンドです。push する前に実行しておくと、CI で落ちることを防げます。

| コンポーネント | コマンド |
|---|---|
| ai-engine | `ctest --test-dir build --output-on-failure -L cpu` |
| api | `cargo fmt --check` / `cargo clippy --all-targets` / `cargo test --locked` |
| web | `npm run verify`(lint、format チェック、依存方向チェック、型チェック、テストをまとめて実行) |

- ai-engine のテストは、すべて `cpu` ラベルが付いています。`device_parity_test` は GPU があるときだけ CUDA との比較も行います。
- `training_smoke_test` は実データ(`apps/backend/ai-engine/TrainingDataset/train`、リポジトリには含めていません)がないと Skipped になります。

## 6. インターフェース定義の変更

| 定義 | 場所 | 変更したあとにすること |
|---|---|---|
| gRPC(Rust ⇔ C++) | [apps/backend/proto](apps/backend/proto) | Rust は `build.rs`、C++ は CMake が自動でコードを生成します。両方を再ビルドしてください |
| REST(web ⇔ Rust) | [apps/backend/openapi/openapi.yaml](apps/backend/openapi/openapi.yaml) | web コンテナで `npm run gen:api` を実行し、`src/api/schema.d.ts` を再生成します |

## 7. データの保存先

コンテナを作り直しても消えないように、次のデータは名前付きボリュームに保存しています。

| ボリューム | 中身 |
|---|---|
| `api-data` | 学習の記録の DB(`/data/training.db`) |
| `cargo-registry` | cargo がダウンロードしたクレート |
| `ccache-data` | C++ のビルドキャッシュ |
| `datasets` | アップロードされたデータセット(`/datasets`)。api-dev が書き込み、ai-engine-dev が読み取り専用で参照 |
| `web-node-modules` | フロントエンドの `node_modules` |

DB を初期化したいときは、コンテナを止めてから `api-data` ボリュームを削除します。

## 8. 注意点

- **`node_modules` はホストと共有しません**: Windows と Linux ではネイティブバイナリ(esbuild など)が異なるためです。パッケージの追加は必ず web コンテナの中で行ってください。
- **Vite はポーリングでファイルの変更を検知します**: Windows のフォルダをマウントすると変更の通知がコンテナに届かないためです。
- **データセットは api-dev と ai-engine-dev で共有しています**: api-dev がアップロードされた zip を `/datasets` に解凍し、ai-engine-dev は同じ `datasets` ボリュームを `/datasets` として読み取り専用で参照します。DB に保存されるデータセットのパスは両方のコンテナで同じになります(本番の [compose.prod.yml](.deploy/compose.prod.yml) と同じ構成です)。
- **コンポーネントごとの VS Code ワークスペース**: `apps/frontend/frontend.code-workspace` などのワークスペースファイルもあります。

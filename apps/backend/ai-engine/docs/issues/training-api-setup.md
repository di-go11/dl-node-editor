# feat: Rust `api` crate 立ち上げ（gRPC クライアント + device バリデーション）

ブランチ: `feat/gRPC-function` / GPU 対応 issue（`gpu-support.md`）の **Phase 2 後半**。
`grpc-layer.md`（Phase 2 前半・C++ 側）からスコープを切り出した issue。

> **命名メモ**: 当初 `training-api` という crate 名で計画していたが、Rust 側は
> 学習 RPC（Phase 3）だけでなく推論 RPC（Phase 4）・将来はブロック UI 向けの
> API 全体（Phase 5）を担う「フロントエンド向けバックエンドAPI」そのものであり、
> 「training」に限定した名前はスコープとズレる。`apps/backend/api/`（`api/grpc`
> という空ディレクトリが既に存在していた）に合わせて `api` crate に改名した。

## 背景

`grpc-layer.md` で C++ 側（gRPC サーバー + `GetCapabilities`）は実装・ビルド・
`grpcurl` での疎通確認まで完了した。Phase 2 のゴールである「Rust から
`GetCapabilities` が叩ける」を満たすには、残る Rust 側 crate の立ち上げが必要。

C++ 側が完了した時点で `grpc-layer.md` を「Rust側の詳細まで含めて肥大化させる」
より、区切りをつけて別 issue に分離した方が読みやすいと判断した。設計判断
（`.proto` の中身、ディレクトリ構成、CMake 側の制約）は `grpc-layer.md` を参照。

## ゴール

- `api` crate が起動時に `GetCapabilities` を叩き、capability を
  キャッシュできる
- device 指定（当面は起動時設定。将来は API リクエスト）を `application` 層の
  ポリシーで検証し、NG なら**エラーで停止**する（サーバー版の方針。
  「黙って CPU に落とさない」を Rust 側に移設。詳細は `gpu-support.md`）
- devcontainer が `api-dev` を含む 2 サービス構成になる

## スコープ

含む:

- Rust crate: `apps/backend/api/`
- `.devcontainer/Dockerfile.rust` + `docker-compose.yml` の 2 サービス化
- `GetCapabilities` の tonic クライアント疎通

含まない（別 issue）:

- 学習 RPC のクライアント実装（`model-config-and-training-rpc.md`、Phase 3）
- フロントエンド連携
- クライアントローカル版（子プロセス起動 + Unix domain socket でのサイドカー化）
  の外殻。開発中の 2 コンテナ構成はサーバー運用・ローカル開発向けであり、
  クライアント単体配布時のパッケージングとは別物（`CLAUDE.md` 参照）

## ディレクトリ構成（`grpc-layer.md` より転記、crate 名は `api` に改名）

```
apps/backend/api/
  Cargo.toml
  build.rs                  # tonic-build で ../proto/capabilities.proto を生成
  src/
    domain/                 # DeviceRequest(cpu / cuda:N) / Capabilities / DeviceValidationError。生成コード非依存
    application/             # ポリシー: device バリデーション
    adapters/grpc/           # tonic クライアント。生成メッセージ <-> domain 変換（既存の空ディレクトリと一致）
    infrastructure/          # 設定読み込み、起動時 capability キャッシュ
    main.rs
```

### 各層の責務

| 層 | 責務 |
|---|---|
| `domain` | `DeviceRequest`（`cpu` / `cuda:N`）、`Capabilities`、`DeviceValidationError`。生成コード非依存 |
| `application` | ポリシー: 「`cuda` 指定だが `cuda_available=false`」「index が `device_count` 以上」を弾き、ユーザー向けメッセージを生成 |
| `adapters/grpc` | tonic クライアント。protobuf メッセージ ↔ `domain` 変換。capability 取得 |
| `infrastructure` | 設定読み込み、起動時に capability を 1 回取得してキャッシュ |

## devcontainer

`.devcontainer/docker-compose.yml` を 2 サービスへ:

```yaml
services:
  ai-engine-dev:      # 既存。gRPC サーバーもここで動かす。50051 を expose
  api-dev:            # 新規。Dockerfile.rust(rustup 不要、公式 rust イメージ + protobuf-compiler)
    depends_on: [ai-engine-dev]
```

- devcontainer の主サービスは C++（`ai-engine-dev`）のまま。Rust は
  `docker compose exec api-dev ...` で個別に開発する想定
- サービス間: `api-dev` → `ai-engine-dev:50051`

## 進め方（順序）

1. `.devcontainer/Dockerfile.rust` + `docker-compose.yml` の 2 サービス化
2. crate 雛形: `Cargo.toml` / `build.rs`(tonic-build) → `cargo build` が通るところまで
3. `adapters/grpc`: tonic クライアントで `GetCapabilities` を叩き、レスポンスが
   取得できることを確認
4. `domain` + `application`: `DeviceRequest` / `Capabilities` 型とポリシー関数
5. `infrastructure`: 起動時に capability を取得してキャッシュ
6. 統合: 検証 NG ならエラー停止（`gpu-support.md` の B-5 を Rust 側へ移設）

## アーキテクチャ上の注意

- 依存方向 `entities(domain) → application → adapters → infrastructure` を維持
- 生成コード（tonic / prost）は `adapters` / `infrastructure` に閉じる。
  `domain` / `application` は protobuf 型を触らない
- `clean-arch-lint` は C++ 側にのみ効く。Rust 側は crate 内の module 構成で
  担保する（レビュー時に手動確認）

## タスク

- [ ] `.devcontainer/Dockerfile.rust`
- [ ] `.devcontainer/docker-compose.yml`: `api-dev` サービス追加
- [ ] `Cargo.toml` / `build.rs`
- [ ] `adapters/grpc`: tonic クライアント → `GetCapabilities` 疎通確認
- [ ] `domain`: `DeviceRequest` / `Capabilities` / `DeviceValidationError`
- [ ] `application`: device バリデーションポリシー
- [ ] `infrastructure`: 起動時 capability キャッシュ
- [ ] 統合: 検証 NG でエラー停止

## 関連

- `docs/issues/grpc-layer.md` — Phase 2 前半、C++ 側（完了）。本 issue はその続き
- `docs/issues/gpu-support.md` — Phase 1（完了）。B-5 起動時チェックの Rust への移設元
- `docs/issues/開発ロードマップ.md`
- `CLAUDE.md` — コンテナ分離 / gRPC のみ / デプロイ形態ごとのパッケージング方針

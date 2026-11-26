# feat: Jenkins による CI の導入（研究室サーバー上）

## 背景

現状、C++ 側には `tests/` に 11 個のテスト実行ファイルがあるが、
**`enable_testing()` / `add_test()` が無く `ctest` で一括実行できない**。各テストは自作の
`check()` と終了コードで判定する形式で、CI から「全部走らせて結果を集計する」ことができない。

目的は次の 2 つ。

- 変更を push するたびにビルドとテストを自動実行し、回帰（regression）を早期に検出する
- CI/CD の仕組み（セルフホスト運用、パイプライン設計、キャッシュ、通知）を実践して学ぶ

## 方針

| 項目 | 決定 | 理由 |
|---|---|---|
| 設置場所 | 研究室サーバーの Docker | 本番と同じ環境でテストできる。GPU も実機で使える。管理者は自分 |
| CI ツール | Jenkins | セルフホスト運用の経験。ゲーム・エンタメ業界で採用例が多いとされる（個別企業は要確認） |
| 変更の検知 | **SCM ポーリング** | サーバーは学内限定のため、GitHub から Webhook が届かない。ポーリングはサーバーから外向きの通信だけで済む |
| 構成 | controller + agent の 2 コンテナ | 管理機能と重いビルドを分離（関心の分離）。agent は既存 `.devcontainer/Dockerfile` を土台にして開発環境と CI 環境を一致させる |
| Docker 連携 | `docker.sock` は共有しない | ホストの root 権限を渡すことと等価で、共有サーバーでは危険 |
| UI の公開 | 学内のみ（可能なら `127.0.0.1` + SSH ポートフォワード） | 認証なしの Jenkins は任意コード実行に直結する |
| 初期のテスト範囲 | **CPU のみ** | 他の利用者の GPU 学習を邪魔しない。GPU テストは後から別ステージで追加 |
| 秘密情報 | Jenkins の Credentials ストアまたは `.env`（Git 管理外） | リポジトリに認証情報を入れない |

## フェーズ

### Phase 1: テストを `ctest` から実行できるようにする（Jenkins 不要）

- `CMakeLists.txt` に `enable_testing()` と既存テストの `add_test()` を追加する
- CPU のみで通るテストと、データ・GPU に依存して落ちるテスト（`training_smoke_test` の `dataset/train` 等）を切り分ける
- Factory（`TorchLossFactory` / `TorchOptimizerFactory`）の単体テストを、題材として追加する
  - 検証するのは「Config の型に応じて正しい具象クラスが組み立てられること」のみ
  - Loss は `ILoss` に種別を返す API が無いため `dynamic_cast` で確認する案を推奨（プロダクトコードを変えない）
  - GoogleTest を新規テストに併用する案（既存の `check()` 形式とは共存）

### Phase 2: Jenkins 基盤

追加予定のファイル（着手前に都度許可を取る）。

| ファイル（案） | 役割 |
|---|---|
| `ci/jenkins/Dockerfile` | controller のイメージ（公式イメージ + プラグイン） |
| `ci/jenkins/plugins.txt` | プラグイン一覧（バージョン固定） |
| `ci/jenkins/casc.yaml` | Configuration as Code。UI を手で設定せず再現可能にする |
| `ci/agent/Dockerfile` | 既存 Dockerfile を土台にした agent |
| `ci/docker-compose.yml` | controller + agent の定義 |
| `Jenkinsfile` | パイプライン定義 |

パイプライン案: `Checkout → Configure(cmake) → Build(-j2) → Test(ctest)`

- ビルド並列度は `-j2`（既存の cmake-build スキルの方針、コンテナのメモリ上限に合わせる）
- ccache のボリュームを agent と共有し、再ビルドを高速化する
- 同時実行数は 1 に制限する

### Phase 3: 通知

テスト終了後に結果を知らせる。**状態が変わったときだけ通知する**（失敗したとき・復旧したとき）。
成功が続くだけなら送らない。毎回送ると通知疲れで読まなくなるため。

#### 通知手段の比較

| 手段 | 長所 | 短所 |
|---|---|---|
| Outlook メール（Mailer / Email Extension プラグイン） | 追加サービス不要 | 下記の認証・ポートの問題がある |
| Discord / Slack の Webhook | HTTPS(443) の外向き通信だけで済み、学内で遮断されにくい。設定も簡単 | 別サービスの登録が必要 |
| GitHub のコミットステータス | コミット・PR 上に ✓/✗ が出る | GitHub トークンの管理が必要 |

#### Outlook メールの注意点

1. **認証方式**: Microsoft は Basic 認証（パスワードのみ）を段階的に廃止している。個人アカウントの SMTP は
   アプリパスワード（要 2 段階認証）または OAuth 2.0 が必要になる可能性がある。
   **実装前に Microsoft の公式ドキュメントで現行仕様を確認すること**（OAuth 2.0 だと Jenkins 側の設定が大幅に複雑になる）
2. **ポート制限**: 学内ネットワークで SMTP 送信ポート(587 等)が遮断されている可能性がある。
   サーバー上で `nc -vz smtp-mail.outlook.com 587` を実行して事前に確認する
3. **秘密情報**: 認証情報は Jenkins の Credentials ストアに入れ、Git や `casc.yaml` に直書きしない。可能なら専用アカウントを使う

#### 方針

まずメールで実装し、認証やポートで詰まったら Webhook に切り替える。
通知の仕組み自体（Jenkinsfile の `post` ブロックで結果に応じて外部へ知らせる）は共通で、学習価値は変わらない。

### Phase 4（将来）: GPU テスト

- GPU を使うテスト（`device_parity_test` の CUDA 側など）を別ステージとして追加する
- 他の利用者の学習と競合しないよう、実行時間帯や対象ブランチを絞る
- `nvidia-container-toolkit` 経由で agent に GPU を渡す

### Phase 5（将来）: Multibranch Pipeline への移行

> **2026-11-11**: CD(自動デプロイ)・言語別 agent と合わせて前倒しで実施する。見るブランチは `main` と `feat/*`。手順は [docs/issues/2026-11-11/ci-cd.md](../../../../../docs/issues/2026-11-11/ci-cd.md) の作業 1 を参照。以下は移行時の検討事項として残す。

現状は「Pipeline script from SCM」の単一ジョブで、ブランチ指定子を `*/main` にして `main` だけを監視している。
この構成では、マージ前の `feat/xxx` ブランチは検証されない（ブランチが `main` から派生していても関係なく、
指定子にマッチしないブランチではパイプラインは回らない）。

マージ前にテストを通したいので、**Multibranch Pipeline** ジョブへ移行する。
Jenkins がリポジトリのブランチを自動検出し、`Jenkinsfile` があるブランチごとにジョブを作ってビルドしてくれる。

移行時に決めること・注意点:

- **ブランチの検出方法**: Webhook が使えないため、Multibranch 側の定期スキャン（Scan Multibranch Pipeline Triggers）で
  新規ブランチを検出する。既存の SCM ポーリング方針（Phase 2）と揃える
- **ソースの種類**: 汎用の Git ソース（Deploy Key を再利用）か、GitHub Branch Source プラグイン（PR の検出ができるが
  トークン管理が増える）か
- **対象ブランチの絞り込み**: 全ブランチをビルドすると agent（`numExecutors: 1`）でキューが詰まる。
  `main` / `feat/*` などに絞る、古いブランチのビルド履歴を自動破棄する設定を入れる
- **`Jenkinsfile` の `pollSCM`**: Multibranch では新規ブランチの検出は定期スキャンが担当するため、
  Jenkinsfile 側の `triggers` との役割分担を整理する
- **ジョブ定義のコード化**: GUI で動作確認したあと、`casc.yaml` の Job DSL（`multibranchPipelineJob`）で定義して
  再現可能にする（`job-dsl` プラグインが追加で必要）

前提: 単一ジョブ（`*/main`）で `Checkout → Configure → Build → Test` が通ることを先に確認しておく。

## セキュリティ上のチェックリスト

- [ ] Jenkins のポートを学内のみ、可能なら `127.0.0.1` にのみ公開する
- [ ] `docker.sock` をマウントしない
- [ ] 管理者パスワード・通知の認証情報を Git にコミットしない（`.env` を `.gitignore` に追加）
- [ ] プラグインのバージョンを固定し、定期的に更新する

## 未決事項

- [ ] `training_smoke_test` が使う `dataset/train` は Git 管理下か（CI で使えるか）
- [ ] 通知手段の最終決定（メール / Webhook）。Outlook の現行認証仕様と 587 番ポートの疎通を確認してから
- [ ] サーバー上の Jenkins 用ポート・ボリューム・ccache の容量
- [ ] CI で GPU を使ってよいか（他の利用者との調整）
- [ ] GoogleTest の入手方法（`apt` か CMake の `FetchContent` か）

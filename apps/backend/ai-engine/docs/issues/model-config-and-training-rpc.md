# feat: モデル定義 config 方式と学習 RPC（ブロック UI より先に縦切りで通す）

ブランチ: 未（`feat/gRPC-function` の後続）。gRPC 対応 issue の **Phase 3**。
`grpc-layer.md`（Phase 2 = `GetCapabilities` で足回り）と `inference.md` の間に入る。

## 背景と結論

成果物の最終形は「ブロック UI でモデル構造・optimizer・loss・活性化・パラメータを
GUI 操作する」もの（`CLAUDE.md`）。しかし **ブロック UI を先に作る必要はない**。

- ブロック UI = 「モデル定義を生成する UI」にすぎない。
- その出力先（＝交換フォーマット）を先に決めて、当面は**人間が手書きした config**
  を食わせて学習パイプラインを縦に貫通させる方が、リスクが前倒しで潰れる。
- ブロック UI は後から「同じ config を吐く別の生産者」として足す。

```
今:  手書き config ──> Rust ──> gRPC ──> C++ ModelFactory ──> 学習 ──> checkpoint / 進捗
後:  ブロック UI  ──> 同じ config ──> （以降まったく同じ経路）
```

したがって **いま設計する config スキーマ（= proto メッセージ）は無駄にならない**。

## 却下した案: 「Layer のコードを渡す」

C++ のレイヤ実装コード（または独自コード文字列）を RPC で送る案は採らない。

| 観点 | コードを渡す | config を渡す（採用） |
|---|---|---|
| 実行 | その場でコンパイル/解釈する仕組みが要る | 登録済みレイヤを type で引くだけ |
| セキュリティ | 任意コード実行。サーバー運用で致命的 | ただのデータ。安全 |
| Rust 側 | 素通しするだけで型の恩恵なし | 同じ config 型を共有できる |
| UI 化 | ブロック→コード生成→再パースの往復 | ブロック→config の一方向 |

どちらにせよ C++ 側は「type 文字列 → レイヤ生成」の **レジストリ（factory）** が必要。
それがある前提なら渡すのは config で足りる。

## config スキーマの表現方針: 汎用ノード＋エッジ

ブロックプログラミング = 計算グラフ。proto での持ち方は 3 案:

| 案 | 形 | 評価 |
|---|---|---|
| A. 厳密型付け | 全レイヤを個別 message 化し `oneof` で列挙 | 型安全だがレイヤ追加のたび proto 改訂。却下（当面） |
| **B. 汎用グラフ** | `Node{ id, type, params: map<string,Value> }` + `Edge{ from, to }` | 拡張が proto 改訂不要。ブロック UI と相性良い。**採用** |
| C. 文字列丸投げ | `string model_config_json = 1` | proto の意味が消える。両側でパーサ二重実装。段階的移行の初手としてのみ可 |

**採用: B を軸に、確定済みの中核だけ必要なら A で補強。**
移行を急ぐ初期段階では `string model_config_json` で走らせ、スキーマが固まってから
構造化 message に締めてよい（`v1` 未凍結）。

`params` の値は妥当性を実行時にチェックする。何が妥当かは `capabilities`
（`GetCapabilities` の拡張 or 新 RPC）で「type → 必要な params のスキーマ」を返し、
将来ブロック UI もそれで駆動する。

## 決めるべきこと（この issue で埋める空欄）

### 1. モデル定義

- [ ] グラフ表現: ノード集合 + エッジ集合で確定してよいか（分岐・合流を許すか、
      当面は線形列だけか）
- [ ] `params` の値型: `oneof { double, int64, bool, string, list }` の範囲
- [ ] 初期化・重み共有・事前学習重みの指定を config に含めるか（含めないなら別 RPC）
- [ ] 入力仕様（チャンネル数・解像度）は config か dataset 由来か

### 2. 学習設定（TrainingSpec）

- [ ] optimizer: `type` + `params`（lr, momentum, weight_decay …）
- [ ] loss: `type` + `params`（ignore_index など。`validation.md` と整合）
- [ ] スケジューラ: 含めるか Phase 3 では固定か
- [ ] epochs / batch_size / seed / device（既存 `Device` entity に対応）
- [ ] dataset の指定方法: パス / ID / どちらも
- [ ] checkpoint: 保存間隔・保存先・再開元（`training-resume.md` と整合）

### 3. 実行制御の方式 ← 早めに決める分岐点

- [ ] **同期 1 本の streaming RPC** か **非同期 job 方式** か
  - 推奨: job 方式。`StartTraining` が `job_id` を返し、
    `StreamProgress(job_id)` で購読、`StopTraining(job_id)` で停止。
  - 理由: 学習は長時間。切断・再接続・途中停止を扱いやすい。
- [ ] 同時に複数 job を許すか（当面 1 でよいか）
- [ ] job の状態: `PENDING / RUNNING / SUCCEEDED / FAILED / STOPPED`

### 4. 進捗・結果（ProgressUpdate）← GUI で見せたいものから逆算

当面 GUI は無いが、**将来グラフ/ログ画面に出す要素**をフィールドとして予約:

```
epoch, step, total_steps,
loss, metrics: map<string,double>,
phase: TRAIN | VAL,
elapsed_sec, eta_sec,
log_message,
checkpoint_saved: string (path)
```

- [ ] metric は map で汎用にするか、mIoU 等を固定フィールドにするか
      （`validation.md` の evaluator が出すものと合わせる）

### 5. エラー表現

- [ ] config バリデーション失敗は gRPC `INVALID_ARGUMENT` + エラー箇所リスト
      （どのノード/params が不正か）
- [ ] 学習中の例外（CUDA OOM 等）は job を `FAILED` にして `StreamProgress` の
      最終メッセージで理由を返す

### 6. 横断ルール

- [ ] package: `aiengine.training.v1`（`grpc-layer.md` は `aiengine.v1`。
      training 専用 proto を分けるか同一 package か決める）
- [ ] ファイル: `apps/backend/proto/training.proto`（capabilities とは別ファイル）
- [ ] enum 先頭は `*_UNSPECIFIED = 0`
- [ ] フィールド番号は不変。削除は `reserved`
- [ ] 単位を名前に入れる（`timeout_sec`, `lr`, `*_bytes`）
- [ ] **Source of Truth**: モデル定義の正は「ブロック UI の状態」。C++/Rust は
      config を受け取って解釈するのみ。変換は常に UI → config の一方向。

## スコープ

含む:

- `apps/backend/proto/training.proto`（config スキーマ + 学習 RPC）
- C++: `TorchModelFactory` を config（グラフ）から組み立てられるよう拡張
- C++: `TrainingService` の gRPC 実装（job 管理 + `StreamProgress`）
- C++: レイヤ/optimizer/loss のレジストリ（type 文字列 → 生成）
- Rust: `training-api` に学習 RPC のクライアント + config 読み込み
- `configs/` にサンプル config を数個（`conv_relu_smoke.json` 等）
- 2 コンテナ compose でのデプロイ確認

含まない（別 issue）:

- React ブロック UI（この issue の config を出力するだけの後続作業）
- 推論 RPC（`inference.md`）
- ハイパラ探索・複数 job 並列

## 進め方（順序）

1. **スキーマ確定**: 上の「決めるべきこと」を埋め、`training.proto` を書く
   （初手は `string model_config_json` でも可）
2. **C++ レジストリ + Factory 拡張**: 既存 `training_smoke_test`（Conv→ReLU）を
   config 経由で組めるところまで。gRPC 抜きでユニットテスト。
3. **gRPC 学習 RPC**: `StartTraining` / `StreamProgress` / `StopTraining`。
   進捗は当面ログ出力で可、GUI は不要。
4. **Rust クライアント**: サンプル config を読んで `StartTraining` を叩き、
   `StreamProgress` を標準出力へ。
5. **デプロイ確認**: 2 コンテナ compose、`training-api` → `ai-engine:50051`。
6. （以降）ブロック UI を別 issue で。

各ステップでビルド確認（`-j2`）。

## タスク

- [ ] 「決めるべきこと」1〜6 を埋める（設計判断）
- [ ] `apps/backend/proto/training.proto`
- [ ] C++: レイヤ/optimizer/loss レジストリ
- [ ] C++: `TorchModelFactory` の config グラフ対応
- [ ] C++: `TrainingServiceImpl`（job 管理 + streaming）
- [ ] Rust: `training-api` に学習 RPC クライアント + config ローダ
- [ ] `configs/` サンプル config
- [ ] 統合: サンプル config で学習が完走し checkpoint が出る
- [ ] compose 2 コンテナでの疎通
- [ ] `grpc-layer.md` / `inference.md` から本 issue へリンク

## アーキテクチャ上の注意

- 依存方向 `entities → application → adapters → infrastructure` を C++ / Rust 両方で維持
- 生成コード（protobuf / tonic）は **adapter・infrastructure に閉じる**。
  config を解釈した結果のドメイン型（グラフ・TrainingSpec）を application へ渡す。
- レジストリの実装（`torch::nn::*` を new する部分）は infrastructure
- `clean-arch-lint` は C++ 側にのみ効く

## 関連

- `docs/issues/grpc-layer.md` — Phase 2。gRPC 足回りと `GetCapabilities`
- `docs/issues/inference.md` — 学習済みモデルでの推論 RPC（本 issue の後）
- `docs/issues/training-resume.md` — checkpoint / resume（config の checkpoint 指定と整合）
- `docs/issues/validation.md` — evaluator が出す metric と `ProgressUpdate` の整合
- `docs/gRPCチュートリアル.md` — proto → 通信の仕組み、設計時の決め事
- `CLAUDE.md` — 成果物（ブロック UI）とコンテナ分離 / gRPC 方針

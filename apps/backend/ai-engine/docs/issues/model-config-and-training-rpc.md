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

## 実装知見: SegNet(encoder-decoder)を線形列 `ModelGraph` で通した経験

この issue を書く前に、`feat/gRPC-function` ブランチで実際に
`segnetProgram.py`（Python/PyTorch 版 SegNet）を C++ の既存 `ModelGraph`
（`std::vector<LayersConfig>` のフラットな直列リスト）上で再現し、GPU で
学習が完走するところまで確認した。この経験は「1. モデル定義」の
グラフ表現の決定に直接効く。

**やったこと**: SegNet の encoder は `MaxPool2d(return_indices=True)`、
decoder は対応する `MaxUnpool2d` で pooling 位置を正確に復元する。これは
「離れたノード同士を結ぶ」という意味では DAG が要りそうに見えるが、
**encoder→decoder が対称であれば LIFO スタックで表現できる**ことが分かった:

- 新しい層タイプを2つ追加: `IndexedPoolingParams`(indices を記録する pooling)、
  `UnpoolingParams`(indices を使って復元する unpooling)。既存の `PoolingParams`
  とは型を分けた(振る舞いが違うものを1つの型にフラグで押し込めない、という
  この codebase の既存方針に従った)
- `ILayer` とは別に `IIndicesSource` / `IIndicesSink` という小さいインターフェースを
  追加。`ModelGraph`/`LayersConfig` 自体は**一切変更していない**
- `TorchModel::forward` が層を順に処理する際、`IIndicesSource` を実装する層が
  出てきたら indices をスタックに積み、`IIndicesSink` を実装する層が出てきたら
  スタックから降ろして渡すだけ。**ノード間の明示的な参照(エッジ)は不要**、
  層を並べる「順序」だけで依存関係が表現できた

**結論**: グラフに「分岐して離れた場所で合流する」ような構造(U-Net の concat 型
skip connection 等)が本当に必要になるまでは、**ノード+エッジへの一般化は不要**。
線形列のままで、SegNet クラスの encoder-decoder モデルは表現できる。

**関連ファイル**（実装の参考。config スキーマ設計時にレイヤ種別の一覧として使える）:
- `src/training/entities/domain-objects/{IndexedPoolingParams,UnpoolingParams}.hpp`
- `src/training/adapters/interfaces/{IIndicesSource,IIndicesSink}.hpp`
- `src/training/infrastructure/torchFunc/{TorchIndexPoolingLayer,TorchUnpoolingLayer}.cpp`
- `src/training/infrastructure/torchModel/TorchModel.cpp`（LIFO スタックの実装）
- `src/training/TrainingApp.cpp`（`buildSegNetGraph` — config 化する前の「正解」の
  グラフ構造として使える）

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

> **見直し中**: トポロジー(線形リスト → DAG)と params の持ち方(汎用 `map` → 型付き `oneof`)は、
> `model-graph-dag.md`(ADR、2026-10-01)で改めて検討している。採用されたらこの節はそちらで置き換える。

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

- [x] グラフ表現: **線形列で SegNet(encoder-decoder + indices)まで表現できることを
      実証済み**（`feat/gRPC-function` ブランチ、C++ 側）。詳細は下の「実装知見」参照。
      U-Net の concat 型 skip connection のような**複数入力を取る層**が要る場面が
      来たら、そこで初めてノード+エッジへ拡張すればよい。当面は線形列のままで
      ブロックしない
- [ ] ノード集合 + エッジ集合(案B)に拡張する場合、上記の「pooling→unpooling の
      LIFO 対応」のような**暗黙の順序依存**をどう明示するか（エッジで表現するのか、
      indices 用の特別な参照フィールドを設けるのか）
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

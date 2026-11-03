# バックエンド(Rust / DB 保存まわり)の残作業

2026-11-03 時点、`feat/SQL` ブランチ。
学習開始時の DB 保存(`model` / `training_runs` / `training_config`)と、新規学習の整合性チェック(`POST /api/v1/trainings/validate`)までは動作確認済み。
ここに挙げるのはその続きの作業。上から順に優先度が高い。

---

## 1. OpenAPI の `StartTrainingRequest` に `mode` を追加する

**背景**
Rust 側の学習開始リクエスト(`StartTrainingRequestDto`)は `mode` が必須になったが、`apps/backend/openapi/openapi.yaml` の `StartTrainingRequest` にはまだない。
React は `mode` を送っていないため、画面から学習を開始すると 422 になる。

**作業内容**
- `openapi.yaml` の `StartTrainingRequest` に `mode` を追加する
  - `{"type": "new"}` または `{"type": "resume", "model_id": "<model_id>"}`
- フロントエンドの `src/api/schema.d.ts` を生成し直す
- `src/infrastructure/http/http-training-api.ts` で `mode` を送る
- 整合性チェックのボタンから `POST /api/v1/trainings/validate` を呼ぶ(204 で学習開始ボタンを有効化、409 で「この名前はすでに使用されています」)

**完了条件**
- 画面から新規学習を開始でき、DB に保存される
- 整合性チェックを通すまで学習開始ボタンを押せない

---

## 2. エポックごとの保存と、学習終了時の更新

**背景**
`insert_epoch`(`training_epochs` と各メトリクステーブル)と `update_training_run`(`status` / `finished_at`)は adapters に実装済みだが、呼び出し元がない。
現状、学習が終わっても `training_epochs` は空、`training_runs.status` は `running` のまま。

**作業内容**
- gRPC で `TrainingEpochProvider` を実装する(`StreamProgressRequest.start_position` に `AfterEpoch(after_epoch)` を入れる。`GrpcTrainingProcessProvider` とほぼ同じ)
- 読み取り用トレイトに `last_saved_epoch` を追加し、SQL で実装する
  - `SELECT COALESCE(MAX(epoch), 0) FROM training_epochs WHERE job_id = ?`
  - C++ の `after_epoch` も「0 = まだ何も完了していない」なのでそのまま渡せる
- `record_training_process.rs` でコメントアウト中の `RecordTrainingProgress::execute` を戻す
  - **終了メッセージを先に判定すること。** C++ の終了メッセージは `epoch = 0` で学習結果を持たないため、そのまま `insert_epoch` するとエポック 0 の偽の行ができる
    ```rust
    if process.status.is_finished() {
        update_training_run(...); break;
    }
    insert_epoch(job_id, process.epoch, &process);
    ```
- 学習開始が成功したら `tokio::spawn` で `execute` をバックグラウンド起動する(ハンドラか `StartTraining` のどちらで起動するかは要検討)

**完了条件**
- 学習を最後まで回すと、全エポックが `training_epochs` に入り、`training_runs.status` が `completed`、`finished_at` が入る
- 途中で Rust を再起動しても、続きのエポックから欠けずに保存される

---

## 3. Resume の整合性チェック

**背景**
整合性チェックは現在、新規学習(同じ `model_name` があれば 409)のみ。
`TrainingModeKind` / `TrainingModeKindDto` は Resume 用に用意済みで未使用。

**作業内容**
- `ValidateTrainingConfig::execute` に `TrainingModeKind` を渡す形に戻す
- Resume のとき、`model_name` で見つかればその `model_id` を返し、見つからなければ `ModelNotFound`(404)
- `/trainings/validate` のレスポンスで `model_id` を返す(新規なら `null`)
- React はその `model_id` を学習開始の `mode: {"type": "resume", "model_id": ...}` に入れて送る

**注意**
学習開始時(`StartTraining`)はサーバー側で `model_id` を検証しない設計にした。
そのため React 側で、チェック成功後に `model_name` や新規/Resume の選択を変えたら、チェック結果を無効にして学習開始ボタンを押せない状態に戻すこと。
(しないと、別モデルの `model_id` と別の名前の組み合わせで学習が始まる)

---

## 4. `.pt` のファイル名を `model_id` に切り替える(proto / C++)

**背景**
C++ は `<checkpointOutputDir>/<model_name>_last.pt`(`_best.pt`)で保存し、`resume_from` が空でもこのファイルがあれば自動で再開する。
改名に強くし、DB の主キーとファイルを一致させるため、`model_id` で保存するように変える。

**作業内容**
- `training.proto` の `StartTrainingRequest` 末尾に `model_id` を追加する
- Rust: `TrainingStarter::start_training` に `model_id` を引数で渡し、`GrpcTrainingStarter` でリクエストに詰める(`model_id` は `TrainingConfig` に含めない)
- C++: マッパー / `StartTrainingCommand` / `TrainingJob` / `TorchCheckpointStore` でファイル名に `model_id` を使う
- C++: `model_id` が空なら `InvalidArgument` で拒否する(空のままだと全学習が `model_last.pt` を共有し、別モデルの重みから黙って再開してしまう)

**要決定**
Resume なのに `.pt` がない場合(最初の保存前に失敗した等)、今の C++ は黙って最初から学習する。
エラーにするなら、proto に resume フラグを足すか、Rust が `resume_from` に `<model_id>_last.pt` を明示する。

**注意**
切り替え後は既存の `<model_name>_last.pt` が自動再開で読まれなくなる。残したい重みがあれば事前に退避する。

---

## 5. 409 のエラーを React で区別できるようにする

**背景**
学習開始の 409 は「すでに学習が実行中」(`AlreadyRunning`)。整合性チェックの 409 は「名前が使用済み」。
今後、学習開始でも名前の重複を 409 にすると、ステータスコードだけでは区別できない。

**作業内容**
- エラーレスポンスのボディにエラーコードを入れる(例: `{"error": "model_name_already_used"}`)
- `insert_model` の `UNIQUE` 違反を `sqlx::Error::Database(e) if e.is_unique_violation()` で判別し、500 ではなく名前重複として返す(チェックと学習開始の間に同名で登録された場合の安全装置)

---

## 6. `model_graph` の保存

**背景**
`model.model_graph`(JSON)はマイグレーションでコメントアウト中。JSON 化には `http/dto` の型に `Serialize` を付け、`ModelGraph` → DTO の逆変換を全レイヤー分書く必要がある。

**作業内容**
- `ModelGraph` を JSON にする変換を実装する(`entities` に serde は入れない)
- **`0001_create_training_tables.sql` は編集しない。** `0002_add_model_graph.sql` のような新しいマイグレーションで列を追加する(`0001` を編集すると既存 DB が `VersionMismatch(1)` で起動しなくなる)
- `insert_model` で `model_graph` も保存する

---

## 7. C++ の学習開始後に `insert_training_run` が失敗した場合の扱い

**背景**
`StartTraining` は「`insert_model` → C++ で学習開始 → `insert_training_run`」の順。最後の INSERT が失敗するとエラーは返すが、C++ の学習は走り続け、記録が残らない。
テスト段階として割り切っている。

**作業内容(案)**
- 失敗時に `TrainingStopper` で C++ の学習を止める(`StartTraining` が `StopTraining` 相当に依存することになる)

---

## 8. Resume 時に前回の設定と比較する(必要になったら)

Resume は前回と条件が揃っていないと成り立たない。`task_type` や `input_width` / `input_height` が違っても、畳み込みだけのモデルではエラーにならず別条件で学習が続いてしまう。
`training_config` の前回値を SELECT し、一致必須の項目を比較する関数を `ValidateTrainingConfig` に足す。どの項目を必須にするかは研究での使い方次第で要決定。

---

## 9. リファクタリング(機能実装が一段落してから)

- ポートのトレイトを `usecases/src/training/ports.rs` に集約する(`TrainingRunRegistar` / `TrainingResultRegister` / `TrainingEpochProvider` は `record_training_process.rs`、`ModelIdGenerator` は `model_id_generator.rs`、`TrainingRecordReader` は `read_training_record.rs` に散らばっている)。`mod.rs` の `pub use` をまとめれば外部パスは変わらない
- `adapters/src/http/handler.rs` を機能ごとに分割する(`http/handler/training.rs` / `capabilities.rs` など)。`http/` 自体は全機能の入口なので `training/` の下には移さない
- 未使用 import の警告を消す(`error.rs` の `std::error`、`ports.rs` / `start_training.rs` / `grpc_training_starter.rs` の `ModelId` など)
- `sql_record_trainig.rs` のファイル名の綴り(`trainig` → `training`)

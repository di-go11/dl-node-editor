# バックエンド(Rust / DB 保存まわり)の残作業

2026-11-04 時点、`feat/SQL` ブランチ。
学習開始時の DB 保存(`model` / `training_runs` / `training_config`)と、新規学習の整合性チェック(`POST /api/v1/trainings/validate`)までは動作確認済み。
ここに挙げるのはその続きの作業。上から順に優先度が高い。

---

## 学習再開の設計方針(2026-11-04 決定)

当初は「学習設定画面で New / Resume を選ぶ」予定だったが、それだと再開なのに `model_name` やモデル構造を入力・編集できてしまう。
そこで、**新規学習と学習再開を画面・API・ユースケースのすべてで分ける**。

```
ノードエディタ
 ├─ [学習設定] → /training            新規専用。名前を入力し、エディタのグラフを使う
 └─ [学習再開] → /resume              学習済みモデルの一覧(Rust が SQL で取得)
                  └─ 選択 → /resume/:modelId   再開用フォーム(モデル構造は触らない)
```

- 再開画面はエディタのドキュメント(`document.training` やグラフ)を使わない。前回の `training_config` を初期値として読み込む
- **(2026-11-09 変更)** 再開リクエストの本体は、`GET /models/{model_id}/config` の応答と同じ `ResumeTrainingConfigDto`(全設定 + `model_id`)にする。取得した設定の変えてよい項目だけを書き換えて、そのまま送り返す
  - 当初は「`model_id` と変えてよい項目だけを送り、名前・構造・データ仕様は Rust が DB から組み立てる」予定だった。DTO を新規学習・設定取得・再開で共有し、往復できる形を優先して変更した
  - 固定項目は**当面はフロントで読み取り専用にするだけ**。バックエンドでの上書き・照合は作業 14 で行う(それまでは、書き換えて送ると C++ が `FailedPrecondition` などで拒否するか、意図しない学習になる)

再開時に変えられる項目は次のとおり(C++ の現在の実装に合わせる)。

| 項目 | 再開時 | 理由 |
|---|---|---|
| `model_name` / `model_graph` | 固定(表示のみ) | C++ は再開時に `.pt` から構造を組み直す(`TrainingJob.cpp`) |
| `data_spec`(タスク・入力サイズ・アノテーション) | 固定(表示のみ) | 出力チャンネル数・前回の条件との整合性のため |
| Optimizer の**種類** | 固定 | 種類が違うと C++ は `optimizer type mismatch` で例外を投げる(`CheckpointArchiveIO.cpp`) |
| Optimizer のハイパーパラメータ(lr など) | 変えられる | C++ 側で load 後に上書きする(作業 6) |
| `epoch` | 変えられる(**合計**エポック数) | C++ と `training_config.epochs` の意味に合わせる。前回の完了エポック数より大きい値が必要 |
| `batch` / `device` / `loss` / `save_last_every` / `seed` / `dataset_path` | 変えられる | checkpoint に依存しない |
| `resume_from` | 送らない | 再開元は `<model_id>_last.pt` に決まる(作業 4) |

Optimizer の種類も変えたい(重みだけ引き継いで、optimizer の状態は捨てる)場合は「再開」ではなく「重みを引き継いだ新しい学習」とみなし、別機能として扱う(新しい `model_id` と `parent_model_id` を持たせる)。今回は対象外。

---

## 1. Resume の途中実装を取り除き、新規学習を React からつなぐ

**背景**
`StartTraining` の `TrainingMode::Resume` 分岐は、渡された `model_id` を検証せずに使う。DB から構造や前回の設定を読む処理もない。
上の方針で再開は別のエンドポイント・別のユースケースにするため、この分岐は使われなくなる。残すと、検証のない経路が残るだけになる。
また、Rust の `StartTrainingRequestDto` は `mode` が必須だが、OpenAPI と React にはまだない。そのため、今は画面から学習を開始すると 422 になる。

**取り除くもの**
- `usecases/src/training/training_mode.rs`(`TrainingMode` / `TrainingModeKind`)と、`mod.rs` の `pub use`
- `adapters/src/http/dto/training_mode.rs`(`TrainingModeDto` / `TrainingModeKindDto`)と、`dto/mod.rs` の `mod`
- `StartTrainingRequestDto` の `mode`。`TrainingConfigDto` をそのまま受け取る形に戻す(`#[serde(flatten)]` のラッパーが不要になれば消す)
- `StartTraining::execute` の `mode` 引数と `match`。常に `insert_model` → C++ で学習開始 → `insert_training_run` の順に処理する
- `start_training.rs` のテスト `resume_uses_given_model_id_without_inserting_model`(同じ内容を作業 5 の `ResumeTraining` のテストに移す)
- `ValidateTrainingConfigError::ModelNotFound` と、ハンドラでの 404 への変換。`validate_training_config.rs` と `handler.rs` の Resume 関連の TODO / コメント
- `record_training_process.rs` でコメントアウトされている `ensure_model`(名前の重複チェックは `ValidateTrainingConfig` が担当する)
- 新規学習の `resume_from`: OpenAPI・`TrainingConfigDto`・React の `TrainingSettings` と入力欄から外す。Rust はいつも空で送る。`entities` の `TrainingConfig.resume_from` は再開時にも使わないので削除する。`training_config.resume_from` 列は `0001` を編集できないので残し、`NULL` を入れる

**残すもの**
- `TrainingRecordReader::find_model_id_by_name` と `ValidateTrainingConfig`(新規学習の名前重複チェック)

**作業内容(React とのつなぎ込み)**
- `openapi.yaml` の `StartTrainingRequest` を Rust の DTO と一致させる(`mode` は追加しない)
- フロントエンドの `src/api/schema.d.ts` を生成し直す
- 整合性チェックのボタンから `POST /api/v1/trainings/validate` を呼ぶ(204 なら学習開始ボタンを有効にする。409 なら「この名前はすでに使用されています」と出す)

**完了条件**
- `cargo test` と フロントの `npm run verify` が通る(この作業で警告を増やさない。以前からある未使用 import などの警告は作業 10 で扱う)
- 画面から新規学習を開始でき、DB に保存される
- 整合性チェックを通すまで学習開始ボタンを押せない

**状況(2026-11-04)**
コードの変更は完了した(`cargo test` と `npm run verify` は通過済み)。実機での確認(React → Rust → C++ で新規学習を開始し、DB に保存される)はまだしていない。
- フロントの `resume_from` は、保存ファイル・C++ 設定ファイル(proto-json)の形を変えないため、読み込みでは読み捨て、書き出しでは常に `""` にした
- 整合性チェックは、手元のチェックが OK のときだけ `POST /trainings/validate` を呼ぶ。409 なら `model_name` を指す error、通信の失敗も error にする(確かめていない内容では実行させない)

---

## 2. エポックごとの保存と、学習終了時の更新

**背景**
`insert_epoch`(`training_epochs` と各メトリクスのテーブル)と `update_training_run`(`status` / `finished_at`)は adapters に実装済みだが、どこからも呼ばれていない。
今は学習が終わっても `training_epochs` は空のままで、`training_runs.status` も `running` のまま。
再開画面の「前回 N エポック完了」の表示にも必要になる。

**作業内容**
- gRPC で `TrainingEpochHistoryProvider` を実装する(`StreamProgressRequest.start_position` に `AfterEpoch(after_epoch)` を入れる。`GrpcTrainingProcessProvider` とほぼ同じ)
- 読み取り用のトレイトに `last_saved_epoch` を追加し、SQL で実装する
  - `SELECT COALESCE(MAX(epoch), 0) FROM training_epochs WHERE job_id = ?`
  - C++ の `after_epoch` も「0 = まだ何も完了していない」という意味なので、そのまま渡せる
- `record_training_process.rs` でコメントアウトしている `RecordTrainingProgress::execute` を戻す
  - **終了メッセージかどうかを先に判定すること。** C++ の終了メッセージは `epoch = 0` で、学習結果を持たない。そのまま `insert_epoch` すると、エポック 0 の偽の行ができる
    ```rust
    if process.status.is_finished() {
        update_training_run(...); break;
    }
    insert_epoch(job_id, process.epoch, &process);
    ```
- 学習の開始に成功したら、`tokio::spawn` で `execute` をバックグラウンドで起動する(ハンドラと `StartTraining` / `ResumeTraining` のどちらで起動するかは要検討。両方の開始経路から起動されるようにする)

**状況(2026-11-04)**
- `TrainingEpochProvider` は `TrainingEpochHistoryProvider` に改名した。`GrpcTrainingProgressProvider`(旧 `GrpcTrainingProcessProvider`)で実装済み(`AfterEpoch(after_epoch)` を送る)
- `last_saved_epoch` は `TrainingProgressReader` に追加し、SQL で実装済み
- `RecordTrainingProgress::execute` は書きかけ。この保存結果をフロントの進捗表示にも使う方針にした(作業 11)

**完了条件**
- 学習を最後まで回すと、全エポックが `training_epochs` に入り、`training_runs.status` が `completed` になり、`finished_at` も入る
- 途中で Rust を再起動しても、続きのエポックから抜けなく保存される

---

## 3. `model_graph` の保存

**背景**
再開時はモデル構造を DB から読んで C++ に送る。また、再開画面で構造を表示するためにも必要になる。そのため、再開(作業 5)の前提になる。
`model.model_graph`(JSON)の列は、マイグレーションでコメントアウトしたまま。

**作業内容**
- `ModelGraph` を JSON にする変換と、JSON から `ModelGraph` に戻す変換を、adapters に実装する(`entities` に serde は入れない)
- **`0001_create_training_tables.sql` は編集しない。** `0002_add_model_graph.sql` のような新しいマイグレーションで列を追加する(`0001` を編集すると、既存の DB が `VersionMismatch(1)` で起動しなくなる)
  - 既存の行があるので、`NOT NULL` にするならデフォルト値が必要になる。または `NULL` を許し、`NULL` のモデルは再開できない扱いにする
- `insert_model` で `model_graph` も保存する

---

## 4. `.pt` のファイル名を `model_id` に切り替え、再開を明示する(proto / C++)

**背景**
今の C++ は `<checkpointOutputDir>/<model_name>_last.pt`(`_best.pt`)という名前で保存する。そして `resume_from` が空でも、このファイルがあれば自動で再開する。
改名に強くし、DB の主キーとファイルを一致させるため、`model_id` で保存するように変える。
また、Rust からは `.pt` があるかどうかを判定できない(サーバー運用では C++ が別のコンテナにあるため)。そこで、再開できるかどうかは C++ が判定する。

**作業内容**
- `training.proto` の `StartTrainingRequest` の末尾に、`model_id` と `bool resume` を追加する
- Rust: `TrainingStarter::start_training` に `model_id` と `resume` を引数で渡し、`GrpcTrainingStarter` でリクエストに詰める(`model_id` は `TrainingConfig` に含めない)
- C++: マッパー / `StartTrainingCommand` / `TrainingJob` / `TorchCheckpointStore` で、ファイル名に `model_id` を使う
- C++: `model_id` が空なら `InvalidArgument` で拒否する(空のままだと全学習が `model_last.pt` を共有し、別モデルの重みから黙って再開してしまう)
- C++: ファイルがあるかどうかによる自動再開をやめ、`resume` フラグで決める
  - `resume = false` なら、いつも最初から学習する(ファイルがあっても読まない)
  - `resume = true` で `<model_id>_last.pt` がなければ `FailedPrecondition`
  - `resume = true` で checkpoint のエポックが指定された合計エポック数以上なら `FailedPrecondition`(今は 0 エポックだけ回して `Completed` を返してしまい、「学習した」と誤解される)

**注意**
切り替えた後は、既存の `<model_name>_last.pt` が自動再開で読まれなくなる。残したい重みがあれば、事前に退避する。

---

## 5. 学習済みモデルの一覧 API と、学習再開 API(Rust)

**背景**
上の方針のとおり。前提として、作業 1・3・4 が必要(作業 2 がないと、完了エポック数が出ない)。

**API**
```
GET  /api/v1/models                     学習済みモデルの一覧
GET  /api/v1/models/{model_id}/config   最新の run の training_config(フォームの初期値と固定項目の表示用)
POST /api/v1/models/{model_id}/resume   学習再開。本体には変えてよい項目だけを入れる
```
- 一覧の各要素: `model_id`, `model_name`, `created_at`, `task_type`, 最後の run の `status` / `started_at` / `finished_at`, 完了したエポック数
  - `training_runs` が 1 件もないモデルは出さない(`insert_model` の後に C++ の学習開始が失敗した場合などにできる。作業 8 を参照)
- 再開の本体: `ResumeTrainingConfigDto`(`GET /config` の応答と同じ形。上の「学習再開の設計方針」を参照)。パスと本体の `model_id` が違えば 400
- 応答: 新規学習と同じ `{ "job_id": ... }`

**状況(2026-11-09)**
3 本のエンドポイントは実装済み(`cargo test` は通過。実機での確認はまだ)。
- `GetModelSummary` / `GetModelTrainingConfig` / `ResumeTraining` ユースケースと、SQL の実装(`adapters/src/training/sql/sql_model_reader.rs`)
- HTTP の DTO(`TrainingConfigDto` 以下)を双方向(Serialize + Deserialize)にし、`ResumeTrainingConfigDto { model_id, #[serde(flatten)] config }` を追加した
- `ResumeTraining` の依存は `AppState` の既存の型パラメータを使い回している(resumer = `S`、`GrpcTrainingStarter` が両方を実装)。作業 12 で分ける
- `ResumeTraining` は、モデルと前回の設定があるかだけを確かめる(なければ 404、`model_graph` が NULL なら 409)。下の手順 3・4 は作業 14 に回した
- 残り: 一覧の `task_type` / 最後の run の `status` / 日時 / 完了エポック数(今は `model_id` / `model_name` / `created_at` だけ)

**作業内容**
- 読み取り用のトレイトに `list_models` / `find_model(model_id)` / `find_latest_config(model_id)` を追加し、SQL で実装する
  - 最新の run は `training_runs` を `started_at DESC` で 1 件取る
  - 完了エポック数は、そのモデルの全 run について `MAX(training_epochs.epoch)` を取る
- `ResumeTraining` ユースケースを新しく作る(`StartTraining` は新規専用のまま)
  1. `find_model` → 見つからなければ `ModelNotFound`(404)
  2. `find_latest_config` → 見つからなければ `NoPreviousRun`(409)
  3. Optimizer の種類が前回と違えば `OptimizerTypeChanged`(422)
  4. 名前・構造・`data_spec` は DB の値、残りはリクエストの値から `TrainingConfig` を組み立てる
  5. `start_training(config, model_id, resume = true)` → `insert_training_run`(`insert_model` はしない)
- C++ の `FailedPrecondition`(checkpoint がない・エポック数が足りない)を `StartTrainingError` に足して、409 にする
- 「そのモデルを学習中か」は DB の `status` では判定しない。C++ は同時に 1 ジョブしか動かさず、`AlreadyRunning` で弾けるため。また、Rust が落ちると `running` のままの行が残り、そのモデルを永久に再開できなくなるため

**注意**
`save_last_every > 1` だと、`.pt` のエポックが DB の最終エポックより前になることがある。その場合、再開した run で同じエポック番号がもう一度記録される。
主キーは `(job_id, epoch)` なので保存では衝突しない。ただし、モデル単位で履歴を表示するときは「新しい run の値を優先する」というルールが必要になる。

**完了条件**
- 新規で学習したモデルが一覧に出て、再開すると前回の続きのエポックから学習が進む
- 再開した run が同じ `model_id` で `training_runs` に追加される

---

## 6. 再開時に Optimizer のハイパーパラメータを反映する(C++)

**背景**
`AdamOptimizer::readFrom` などは `_optim->load()` で状態を復元する。libtorch の optimizer の load は param_groups の options(lr など)も復元するので、新しく指定した lr などは checkpoint の値で上書きされて効かないはず(要確認)。

**作業内容**
- まず、再開時に lr を変えて、実際に使われる lr をログで確認する
- 上書きされていたら、`readFrom` の後で、`command.optimizer` の値を各 param_group の options に設定し直す(モーメントなどの状態は引き継ぐ)

---

## 7. 学習再開画面(React)

**作業内容**
- ノードエディタのヘッダーに [学習再開] を追加し、`/resume` に移動する
- `/resume`: `GET /models` の一覧を表示する(名前・タスク・最終学習日時・状態・完了エポック数)
- `/resume/:modelId`: `GET /models/{model_id}/config` で初期値を読み込む
  - 固定項目(名前・構造・`data_spec`・Optimizer の種類)は表示だけにする。フォームの部品は新規画面の `TrainingForm` を再利用し、固定項目を読み取り専用にできるようにする
  - `epoch` には「前回 N エポック完了」と表示し、N + 1 以上を必須にする
  - 状態はこの画面の中だけで持つ(エディタのドキュメントを変えない)
- 整合性チェックは React のフォーム検証だけにする。サーバー側の検証は再開 API の中で行う(チェックと開始の間に DB が変わっても安全なため)
- 再開に成功したら `/progress/:jobId` に移動する

---

## 8. 学習開始の途中で失敗した場合の扱い

**背景**
`StartTraining` は「`insert_model` → C++ で学習開始 → `insert_training_run`」の順に処理する。
- 最後の INSERT が失敗すると、エラーは返すが C++ の学習は走り続け、記録が残らない(`ResumeTraining` も同じ)
- C++ の学習開始が失敗すると、`model` の行だけが残る。その名前は使用済みになるが、一覧にも出ず、再開もできない
テスト段階として割り切っている。

**作業内容(案)**
- `insert_training_run` が失敗したら、`TrainingStopper` で C++ の学習を止める(`StartTraining` が `StopTraining` 相当に依存することになる)
- C++ の学習開始が失敗したら、`model` の行を削除する。または、`model` の INSERT と `training_runs` の INSERT をまとめて、開始に成功した後に 1 トランザクションで行う(この場合は名前の重複を開始前に確かめられないので、作業 9 の UNIQUE 違反の判別が必須になる)

---

## 9. 409 のエラーを React で区別できるようにする

**背景**
409 には「すでに学習が実行中」(`AlreadyRunning`)、「名前が使用済み」(整合性チェック)、「再開できない」(作業 5)の 3 種類があり、ステータスコードだけでは区別できない。

**作業内容**
- エラー応答の本体にエラーコードを入れる(例: `{"error": "model_name_already_used"}` / `"already_running"` / `"checkpoint_not_found"`)
- `insert_model` の `UNIQUE` 違反を `sqlx::Error::Database(e) if e.is_unique_violation()` で判別し、500 ではなく名前の重複として返す(チェックと学習開始の間に、同じ名前のモデルが登録された場合の安全装置)

---

## 10. リファクタリング(機能の実装が一段落してから)

- ポートのトレイトを `usecases/src/training/ports.rs` にまとめる(`TrainingRunRegistar` / `TrainingResultRegister` / `TrainingEpochHistoryProvider` は `record_training_process.rs`、`ModelIdGenerator` は `model_id_generator.rs`、`TrainingRecordReader` は `read_training_record.rs` に散らばっている)。`mod.rs` の `pub use` をまとめれば、外部からのパスは変わらない
- `adapters/src/http/handler.rs` を機能ごとに分割する(`http/handler/training.rs` / `models.rs` / `capabilities.rs` など)。`http/` 自体は全機能の入口なので、`training/` の下には移さない
- 未使用の import の警告を消す(`error.rs` の `std::error`、`ports.rs` / `start_training.rs` / `grpc_training_starter.rs` の `ModelId` など)
- ファイル名の綴りを直す(`sql_record_trainig.rs` の `trainig` → `training`)

---

## 11. 学習の進捗表示を C++ 直結から DB 経由に切り替える(2026-11-04 提案・未決定あり)

**背景**
今の HTTP の進捗取得(`GET /trainings/{job_id}` / `/status` / `/progress` の SSE)は、`TrainingProgressProvider` で C++ から「最新の状態だけ」を受け取って返している(`start_position: None`)。
このモードは、待っている間に複数の更新があると**途中の更新を飛ばす**。そのため、フロントのグラフでは次の問題が起きる。
- エポックが速く進むと、グラフの点が抜ける
- 途中から画面を開いた・リロードした・接続が切れて戻ったとき、それまでの履歴が取れない
- 学習が終わった後や C++ を再起動した後は、何も表示できない

作業 2 で全エポックを DB に保存するようになるので、フロントには DB の内容を返せば足りる。

**方針**
```
[書き込み側]  C++ ──gRPC(AfterEpoch)──▶ RecordTrainingProgress ──▶ SQLite
                                         (裏で常に動くタスク)
[読み出し側]  フロント ◀──HTTP/SSE── GetTrainingHistory ◀── SQLite
```
フロントは C++ と直接つながらず、DB だけを見る。
- データの出どころが DB に一本化される
- 何人が見ても、C++ への接続は Recorder の 1 本だけで済む
- 学習が終わった後でも、同じ API で履歴を見られる

### 書き込み側: `RecordTrainingProgress`(作業 2 の続き)
```rust
impl<P, R> RecordTrainingProgress<P, R>
where
    P: TrainingEpochHistoryProvider,
    R: TrainingProgressReader + TrainingProgressRecorder + TrainingRunRegistar,
{
    pub async fn execute(&self, job_id: &JobId) -> Result<(), RecordError> {
        // 1. last_saved_epoch で続きの位置を調べる
        // 2. stream_epoch_after(job_id, after_epoch)
        // 3. status が Running なら insert_epoch
        //    status が終了系なら update_training_run を呼んで終了
        //    (C++ は最後に epoch=0 の終了メッセージを1回だけ送るので、insert してはいけない)
    }
}
```
- 起動するタイミングは次の 2 つ。`tokio::spawn` は adapters / server 側の責務にする
  1. `StartTraining`(と作業 5 の `ResumeTraining`)が成功した直後
  2. サーバーの起動時。`find_running_job_ids` で `running` のジョブを取り出し、それぞれの記録を再開する
- 停止したときは C++ が `Stopped` を流してくるので、`stop_training` 側で DB を更新する必要はない

### 読み出し側: `GetTrainingHistory`
```rust
// entities に追加
pub struct EpochRecord {
    pub epoch: u32,
    pub train_loss: f64,
    pub val_loss: f64,
    pub metrics: Option<Metrics>,
    pub epoch_elapsed_time: Duration,
}
pub struct TrainingHistory {
    pub status: TrainingJobStatus,  // training_runs から取得
    pub epochs: Vec<EpochRecord>,   // training_epochs と metrics 系のテーブルから取得
}

// usecases に追加するポート
pub trait TrainingHistoryReader {
    fn find_status(&self, job_id: &JobId)
        -> impl Future<Output = Result<Option<TrainingJobStatus>, RepositoryError>> + Send;
    fn find_epochs_after(&self, job_id: &JobId, after_epoch: u32)
        -> impl Future<Output = Result<Vec<EpochRecord>, RepositoryError>> + Send;
}

// ユースケースは1つで、3つのエンドポイントすべてに使う
GetTrainingHistory::execute(job_id, after_epoch) -> Result<TrainingHistory, ...>
```

| エンドポイント | 使い方 |
|---|---|
| `GET /trainings/{job_id}` | `after_epoch = 0` で全履歴を返す(グラフの初期表示用) |
| `GET /trainings/{job_id}/status` | `history.status` だけを返す(`find_status` を直接呼ぶ軽量版でもよい) |
| `GET /trainings/{job_id}/progress`(SSE) | ハンドラが 1 秒ごとに `after_epoch = 最後に送ったepoch` で呼ぶ。新しいエポックを送り、status が終了系で新しいエポックもなければ終える |

- ポーリングの待機(`tokio::time`)はハンドラ側に置き、ユースケースは「1 回取得する」だけにする(ユースケースのテストを簡単にするため)
- まずは DB のポーリングで作る。遅延が気になるようになったら、Recorder が insert した後に `tokio::sync::broadcast` で通知する方式にする

### 削除するもの
- `TrainingProgressProvider` / `GetTrainingProcess`(`get_training_progress.rs`)
- `GrpcTrainingProgressProvider` の `TrainingProgressProvider` 実装(`start_position: None` の経路)。`TrainingEpochHistoryProvider` の実装は残す
- `handler.rs` の `fetch_current_process`

### 未決定(決めてから着手する)
1. **`total_elapsed_time` の扱い**: `TrainingProcess` にはあるが、`training_epochs` テーブルに列がない
   - (a) `0002` 以降のマイグレーションで `total_elapsed_ms` 列を追加する
   - (b) 読み出すときに `epoch_elapsed_ms` を累積して計算する(再開をまたぐと実際の経過時間とずれる)
   - (c) API から外す
2. **C++ との接続が切れたとき**(C++ が落ちた、ジョブが `NotFound` など)の扱い → 作業 13 で詳しく検討する。決まったらここにも反映する
   - (a) `failed` に更新する
   - (b) `running` のまま、一定間隔で再接続を試みる
   - (c) まずはログを出すだけにする
3. **NULL の扱い**: DB の `train_loss` / `val_loss` は NULL を許す。`EpochRecord` も `Option<f64>` にするか、NULL を `RepositoryError::InvalidData` として扱うか
4. **進め方**
   - (a) まず読み出し側から作る(Recorder がまだないので、テストデータを手で入れて確認する)
   - (b) 書き込み側の Recorder(作業 2)を先に完成させる

提案: 1-(a)、2-(c)、3 は `Option<f64>`、4-(b)(Recorder が動かないと、読み出し側を実データで確認できないため)。

**完了条件**
- 学習中に画面を開き直しても、1 エポック目からのグラフが表示される
- エポックが速く進んでも、グラフの点が抜けない
- 学習が終わった後、または C++ を再起動した後でも、同じ API で履歴と最終ステータスが取れる

---

## 12. 入力ポートを導入し、HTTP 層からユースケースの内部依存を隠す(2026-11-05 提案)

**背景**
- いまの HTTP ハンドラは、ユースケースの具体的な構造体(例: `StartTraining<S, R, G, K>`)を直接受け取っている
- ジェネリクス(静的ディスパッチ)で依存を注入しているため、ユースケースの**内部依存がそのまま型名に出てしまう**
  - `StartTraining` を保持・受け渡しする handler / state / router のすべてが `S, R, G, K` を並べる必要がある
  - `StartTraining` が使う出力ポートを 1 つ増やしただけで、それを使わない HTTP 層まで修正が必要になる(`ProgressRecordingScheduler` の `K` を足したときに実際に起きた)
- 依存性の方向(adapters → usecases)は守られているが、カプセル化が破れている。HTTP 層が知りたいのは「設定を渡すと `JobId` が返る」ことだけである

**方針**
- クリーンアーキテクチャの**入力ポート**(コントローラがユースケースを呼ぶための抽象)をトレイトとして定義する
  - 出力ポート: ユースケースが外部に依頼するもの(`TrainingStarter` / `TrainingStopper` / `ProgressRecordingScheduler` など)
  - 入力ポート: 外部(HTTP ハンドラ)がユースケースを呼ぶもの(今回追加する)
- `usecases/src/training/ports.rs` の中で、コメントで「入力ポート」と「出力ポート」に分けて置く(新規ファイルは作らない)
- 静的ディスパッチのジェネリクス `U` で受け取る(新しい crate が不要で、実行時コストもない)。`Arc<dyn ...>` にすると `AppState` からジェネリクスを完全に消せるが、`async-trait` か `Pin<Box<dyn Future>>` が必要になるため、今回は採用しない

```rust
// usecases/src/training/ports.rs
// ===== 入力ポート(HTTP などの外部 → ユースケース) =====
pub trait StartTrainingUseCase {
    fn execute(&self, config: &TrainingConfig)
        -> impl Future<Output = Result<JobId, StartTrainingError>> + Send;
}

// ===== 出力ポート(ユースケース → インフラ) =====
pub trait TrainingStarter { ... }
pub trait TrainingStopper { ... }
pub trait ProgressRecordingScheduler { ... }

// start_training.rs
impl<S, R, G, K> StartTrainingUseCase for StartTraining<S, R, G, K> where /* 各出力ポートの境界 + Sync */ { ... }

// adapters/src/http/handler.rs
pub async fn start_training<U>(State(start): State<Arc<U>>, Json(dto): Json<TrainingConfigDto>) -> ...
where
    U: StartTrainingUseCase + Send + Sync + 'static,
```

**手順**
1. `StartTraining` だけで入力ポートを導入する(`StartTrainingUseCase`)。handler / state / router の `S, R, G, K` を `U` 1 つに置き換える
2. 問題がなければ、他のユースケース(`GetCapabilities` / `GetTrainingProcess` / `StopTraining` / `ValidateTrainingConfig`)にも広げる
3. `AppState` の型パラメータを「ユースケース 1 つにつき 1 つ」にする(現状の 9 個から 5 個程度)
4. 同時に、`AppState.record_training` と型パラメータ `D` を削除する(進捗記録はワーカー経由になり、HTTP 層では使わないため)
5. 作業 10 の「ポートのトレイトを `ports.rs` にまとめる」と合わせて進めてもよい

**注意点**
- 返す Future に `+ Send` を付けるため、`StartTraining` の中身(`S, R, G, K`)は `Sync` である必要がある(`&self` を `.await` をまたいで保持するため)
- ハンドラのテストで、ユースケースのフェイク(`StartTrainingUseCase` を実装した小さな構造体)を直接差し込めるようになる

**完了条件**
- `StartTraining` に出力ポートを追加・削除しても、`adapters/src/http/` 以下を修正せずにビルドが通る
- `AppState` / `router` の型パラメータがユースケースの数と一致している

---

## 13. 記録タスクが途中で終わった・止まったときの扱い(2026-11-06 提案・未決定あり)

**背景**
- 進捗の記録は `run_recording_worker` が job_id ごとにタスクを起動して行う。二重保存は次の 3 段で防げている
  1. ワーカーの `running`(同じ job_id のタスクが実行中なら起動しない)
  2. `RecordTrainingProgress::execute` の `last_saved_epoch`(保存済みのエポックの続きから C++ に要求する)
  3. `training_epochs` の `PRIMARY KEY (job_id, epoch)`
- 一方で、**記録が途切れたまま誰も再開しない**ケースが残っている。記録の再開(`ResumeProgressRecordings`)は Rust サーバーの起動時にしか走らないため
- 作業 11 の「未決定 2」(C++ との接続が切れたときの扱い)と同じ問題。ここで方針を決めて、作業 11 にも反映する

**起きるケース**
1. **Rust は動いたまま、ストリームだけが切れる**(C++ の再起動、通信断など)
   - 記録タスクは `StreamEnded` / `InvalidData` などのエラーで終わり、`running` から外れる
   - 次に schedule されるのは Rust の再起動時なので、それまで記録が止まる。DB の `training_runs.status` は `running` のまま残る
2. **C++ が再起動した**
   - C++ のジョブはメモリ上(`TrainingJobManager` の `_jobs`)にしかないため、その job_id は C++ から消えている
   - Rust の起動時に `find_running_job_ids` で再開しようとしても、C++ が `NotFound` を返して失敗する。DB の `running` は残り続け、起動するたびに失敗する
3. **接続が切れずに固まる**
   - gRPC の keepalive やタイムアウトを設定していないため、ストリームが終わらないまま待ち続ける可能性がある
   - その job_id はワーカーの `running` に残り続ける(タスクが job_id を占有するのはこのケースだけ)

**未決定(決めてから着手する)**
1. **ケース 1(ストリームが切れたが、C++ にジョブは残っている)**
   - (a) ワーカーまたは記録タスクの中で、間隔を空けて数回リトライする(`last_saved_epoch` から続きを取るので、二重保存にはならない)
   - (b) リトライせず、Rust の再起動まで待つ(今の挙動)
2. **ケース 2(C++ にジョブがない)**
   - (a) `NotFound` を受けたら `update_training_run` で `failed` にする(`failure_reason` に「C++ 側でジョブが失われた」と入れる)
   - (b) `running` のまま残し、ログだけを出す
3. **ケース 3(固まる)**
   - (a) `GrpcTrainingProgressProvider` の `Channel` に HTTP/2 keepalive(`http2_keep_alive_interval` / `keep_alive_timeout`)を設定し、切断として検知できるようにする → ケース 1 か 2 に合流する
   - (b) 記録タスク全体に `tokio::time::timeout` をかける(学習時間に上限がないため、値を決めにくい)
4. **リトライをどこに置くか**(1-(a) を選んだ場合)
   - (a) `RecordTrainingProgress::execute` の外側(adapters のワーカーに渡すクロージャ)でリトライする。ユースケースは「1 回記録を試みる」だけにする
   - (b) ユースケースの中でリトライする(待機に `tokio::time` が必要になり、ユースケースのテストに時間の制御が入る)

提案: 1-(a)、2-(a)、3-(a)、4-(a)。リトライの待機は、作業 11 のポーリングと同じ理由で adapters 側に置く。`NotFound` はリトライしても回復しないので、リトライの対象から外して、すぐに 2-(a) の処理に進める。

**手順**
1. `RecordError` で「回復できる失敗(ストリーム切断)」と「回復できない失敗(`NotFound`)」を区別できるようにする(`StreamOpenFailed` の中身を見るか、バリアントを分ける)
2. `NotFound` のときは `update_training_run(job_id, Failed { reason })` を呼んで終える
3. main.rs のクロージャ(またはワーカー)に、回復できる失敗のときのリトライを追加する
4. `GrpcTrainingProgressProvider` の `Channel` に keepalive を設定する

**完了条件**
- 学習中に C++ との接続が一時的に切れても、つながり直せば、抜けたエポックなしで記録が続く
- C++ が再起動してジョブが消えた場合、そのジョブは `failed` になり、Rust を再起動しても再開を試み続けない
- どのケースでも、同じエポックが二重に保存されない

---

## 14. 学習再開で固定項目をバックエンドでも守る(2026-11-09 提案)

**背景**
再開リクエストの本体は全設定を含む `ResumeTrainingConfigDto` にしたので(作業 5)、クライアントは `model_name` / `model_graph` / `data_spec` / Optimizer の種類を書き換えて送ることができる。
今はフロントで読み取り専用にしているだけで、バックエンドでは確かめていない。
- curl などで直接呼んだ場合や、フロントのバグ(state の取り違えなど)で、checkpoint と合わない設定が C++ に届く
- 構造が違えば C++ が `.pt` の読み込みで失敗するが、分かるのは学習を始めるときで、エラーも分かりにくい

**作業内容**
- `ResumeTraining::execute` では、すでに `ModelTrainingConfigProvider::fetch` で前回の設定を読んでいる(今は存在確認にしか使っていない)。これを使って次の処理を行う
  - `model_name` / `model_graph` / `data_spec` は、リクエストの値を使わず DB の値で上書きする(フロントには表示用に返しているだけなので、送り返された値は信用しない)
  - Optimizer の種類が前回と違えば `OptimizerTypeChanged`(422)を返す(C++ は `optimizer type mismatch` で例外を投げるため)
- 余力があれば、`epoch` が前回の完了エポック数以下なら、C++ に送る前に 409 を返す(作業 2 の `last_saved_epoch` をモデル単位で使う)

**完了条件**
- 再開リクエストの `model_graph` を書き換えて送っても、保存されている構造で再開される
- Optimizer の種類を変えて送ると 422 が返り、C++ には送られない

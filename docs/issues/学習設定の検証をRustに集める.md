# refactor:学習設定の誤りを、学習開始前にまとめてフロントへ返す

## 問題点

学習設定(epoch / batch / optimizer / loss / data_spec / model_graph など)の値の検証は、いまは C++(`api/grpc/TrainingProtoMapper.cpp`)の学習開始の中だけで行っている。Rust の `ValidateTrainingConfig` が確認しているのは、同じ `model_name` が DB にないかどうかだけ。

このため次の問題がある。

| # | 問題 | 該当箇所 |
|---|---|---|
| 1 | 設定が不正でも、`model` の行が DB に残る。`StartTraining` は `insert_model` → C++ で学習開始の順に処理するので、C++ が `INVALID_ARGUMENT` で断った時点で行はもうできている。値を直して同じ名前で送り直すと、`ModelNameAlreadyUsed` で断られる | `usecases/training/start_training.rs` の `execute()` |
| 2 | 設定の誤りと、学習エンジン側の失敗(実行中・checkpoint がない など)を、フロントが区別しにくい。`InvalidConfig` は `AlreadyRunning` などと同じ 409 になる | `adapters/http/handler.rs` の `status_code_from_start_error()` |
| 3 | 誤りが 1 つずつしか返らない。C++ は最初に見つけた違反で例外を投げる(グラフ構造の違反だけはまとめて返す) | `TrainingProtoMapper.cpp` の `invalid()` |
| 4 | C++ でも確認していない項目がある(Adam の beta、SGD の nesterov と momentum の組み合わせ、Focal / Combo の alpha など)。不正な値が libtorch まで届き、学習が始まってから落ちる | 下の「検証する項目」で **追加** と書いたもの |
| 5 | 整合性チェック API(`POST /trainings/validate`)では値の誤りもグラフの誤りも分からない。フロントは学習開始を押すまで気づけない | `usecases/training/validate_training_config.rs` |
| 6 | モデルの出力チャンネル数とクラス数のずれを、学習開始前にどこでも確かめていない。CUDA の device-side assert で落ち、ai-engine の再起動が要る | 「学習開始前のモデル出力とクラス数の確認.md」 |

## 方針(2026-11-26 決定)

**設定の誤りは、学習を始める前にすべて集めて、Rust からフロントへ 1 つの形(422 + 違反の一覧)で返す。** 確認は内容によって Rust と C++ で分担する。

| 種類 | 例 | どこで確認するか |
|---|---|---|
| 学習のハイパーパラメータ・各層のパラメータの値 | `learning_rate <= 0`、`warmup_epochs >= epoch`、`kernel_size = 0` | **Rust**(entities。段階 1) |
| モデルのグラフの構造 | 未接続の必須ポート、存在しないノードの参照、閉路 | **C++**(新しい RPC `ValidateModelGraph`。段階 2・3) |
| モデルのグラフの形(shape) | 層の入力チャンネル数が前の層と合わない、出力チャンネル数 ≠ クラス数、出力の H / W が入力と違う | **C++**(同上) |
| 設定と関係のない失敗 | 学習がすでに実行中(`ABORTED`)、再開用の checkpoint がない(`FAILED_PRECONDITION`)、CUDA のエラー、学習中の例外 | C++(学習開始の応答や進捗で返す。これまでどおり) |

グラフを C++ に任せる理由:

- 構造と形の検証は C++ にすでにあり(`GraphValidation.cpp`、`GraphShapeInference.cpp`、`NodeShapeRules.hpp`。テストを除いて約 1,100 行)、見つけた問題をノード・入力・出力の添字付きですべて返す作りになっている。Rust に移すと同じ規則が 3 か所(C++ / Rust / フロント)に並ぶ
- 形の検証にはクラス数が要る。C++ はデータセットの `labelmap.txt` をすでに読める(`loadDatasetLabelMap`)
- 静的な計算だけなので一瞬で終わり、GPU を使わない。学習中でも呼べる

検討して採らなかった案: 学習を 1 バッチだけ試しに流して確かめる。クラス数のずれを GPU で流すと device-side assert で ai-engine が使えなくなる、libtorch の例外からはどのノードの誤りか分からない、数秒〜数十秒かかる、学習中は試せない、のため。

### 動作確認(2026-11-26)

- `.deploy`(`compose.prod.yml`)の構成で、整合性チェックが正しく動くことを確認した(コミット `8741a5b` / `fcdcc3e`。学習率スケジューラは none 固定)
- dev コンテナ(`.devcontainer/docker-compose.yml`)では、データセットを登録していなかったため、整合性チェックが「データセットが見つからないか、読めません」(422)になった。設定の検証の不具合ではない
    - この 422 は、データセットがない・色表が読めない・リクエストの JSON の形が合わない、の 3 つが同じ文言になり、原因を探しにくかった
    - 対応(2026-11-26、未ビルド・未テスト): 違反の一覧のない 422 の本文に原因のコード(`ErrorCode`)を入れ、フロントで文言を分けた(作業 9 と同じ考え方)

        | 原因 | 本文 | フロント(整合性チェック) | フロント(学習開始・再開) |
        |---|---|---|---|
        | データセットが登録されていない | `{"error": "dataset_not_found"}` | 「データセット」欄に error(`training/dataset-not-found`) | その原因の説明 |
        | 色表(labelmap.txt)が読めない | `{"error": "dataset_unreadable"}` | 「データセット」欄に error(`training/dataset-unreadable`) | その原因の説明 |
        | リクエストの中身(空の dataset_id など) | `{"error": "invalid_request"}` | その原因の説明のエラー | その原因の説明 |
        | JSON として読めない・フィールドが足りない | axum の text/plain の説明 | 「リクエストの形が合わない」エラー | 同じ |

        - Rust: `http/dto/error_code.rs`(`ErrorCodeDto` / `ErrorCode`)、`handler.rs` の `error_code_response()`
        - フロント: `infrastructure/http/server-error-code.ts`(コードの読み取りと文言、`trainingRejectionDetails()`)、`api-client.ts` の `ErrorDetails`(本文から説明と違反の一覧を上書きする)
        - openapi: 3 つのエンドポイントの 422 を `oneOf: [InvalidConfig, ErrorCode]` にし、`ErrorCode` のスキーマを追加
        - 再開で optimizer の種類を変えたときの 422 は、いまも本文なし(状態コードの説明のまま)

---

## 段階 1. 値の範囲の検証(Rust)

### 状況(2026-11-26)

実装済み。`lr_scheduler` まわりの API(DTO・DB・proto への変換)がつながれば、ワークスペース全体のビルドとテストが通る(scratchpad のコピーで、`lr_scheduler` を仮に埋めて確認済み)。

- entities: `validation.rs`(`ConfigViolation` / `Violations`)、`TrainingConfig::validate()`、`DataSpec::validate`、`NodeSpec::validate`、`ModelGraph::validate_params`
- usecases: `StartTraining` は `insert_model` の前に検証する。`ResumeTraining` は前回の設定に上書きした後で検証する。`ValidateTrainingConfig` は名前の重複の前に検証する
- adapters: 違反は 422 + 下の本文。C++ の `INVALID_ARGUMENT`(`EngineRejectedConfig`)と `ConversionToProtoFailed` は Rust 側のバグとして 500
- openapi: 3 つのエンドポイントの 422 に `InvalidConfig` を追加

### 検証する項目

「C++」の列は、いま C++ で確認しているかどうか。**追加** は C++ にもない項目。

| 項目 | 規則 | C++ |
|---|---|---|
| `model_name` | 空・空白だけでない | **追加** |
| `epoch` / `batch` | 1 以上 | あり |
| `device` | `cpu` / `cuda` / `cuda:<0 以上の整数>` | あり |
| `optimizer.learning_rate`(全種類) | 0 より大きい | あり |
| `optimizer.weight_decay`(全種類) | 0 以上 | **追加** |
| Adam / AdamW の `beta1` / `beta2` | 0 以上 1 未満 | **追加** |
| Adam の `eps` | 0 より大きい | あり |
| SGD の `momentum` | 0 以上 | **追加** |
| SGD の `nesterov` | `true` なら `momentum > 0`(libtorch の SGD が要求する) | **追加** |
| `lr_scheduler`: poly の `power` | 0 より大きい | 未実装 |
| `lr_scheduler`: cosine の `min_lr` | 0 以上、`optimizer.learning_rate` 以下 | 未実装 |
| `lr_scheduler`: step の `step_size` / `gamma` | `step_size` 1 以上、`gamma` 0 より大きく 1 以下 | 未実装 |
| `lr_scheduler.warmup_epochs` | `epoch` より小さい。none のときは 0 | 未実装 |
| Focal の `gamma` / `alpha` | `gamma` 0 以上、`alpha` 0 より大きく 1 以下(0 だと損失が常に 0 になる) | **追加** |
| Combo の `alpha` | 0 以上 1 以下(0 なら Dice だけ、1 なら Cross Entropy だけ) | **追加** |
| `data_spec.input_width` / `input_height` | 1 以上 | あり |
| segmentation の `ignore_index` / `ignore_color_r` / `_g` / `_b` | 0〜255 | あり |
| Conv2d | `in_channels` / `out_channels` / `kernel_size` / `stride` / `dilation` 1 以上、`padding` 0 以上 | あり |
| Pooling2d / IndexedPooling / Unpooling | `kernel_size` / `stride` 1 以上、`padding` 0 以上 | あり |
| Pooling2d / Activation / Upsample の種類 | `Unspecified` でない | あり |
| BatchNorm | `num_features` 1 以上、`eps` 0 より大きい | あり |
| Linear | `in_features` / `out_features` 1 以上 | あり |
| Upsample | `scale_factor` 1 以上 | あり |
| Add | `alpha` が有限の値 | あり |

- `device` のデバイスが実際にあるかは確かめない(実行環境の状態によるため。ない場合は C++ の学習開始の失敗として返る)
- `dataset_path` は Rust がデータセット ID から決める値なので、検証は要らない

### 応答の形

```json
{
  "error": "invalid_config",
  "violations": [
    { "field": "optimizer.learning_rate", "message": "0 より大きくしてください(0)" },
    { "field": "model_graph.nodes[3].inputs[0]", "message": "必須の入力ポートがつながっていません" }
  ]
}
```

- `field` はリクエストの JSON と同じ項目名。フロントはこれで欄やブロックを特定する
- グラフの違反(段階 3)も同じ一覧に入る

---

## 段階 2. C++ にグラフの検証 RPC を作る

### 状況(2026-11-26)

コードは書いた。**まだビルドもテストもしていない**(C++ のビルド環境のあるコンテナで確認する)。

- CMake は `CMakeLists.txt` を変えたので再設定される。新しい `src/training/ModelGraphCheck.cpp` は `ai_engine_lib` の GLOB で拾われる
- 確認するテスト: `training_proto_mapper_test`(変換と応答の詰め方を追加)、`model_graph_check_test`(新規)、`graph_shape_inference_test`(下の変更で既存のテストが壊れていないか)

### proto(`training.proto`。実装済み)

```proto
service TrainingService {
    // ...(既存)
    rpc ValidateModelGraph(ValidateModelGraphRequest) returns (ValidateModelGraphResponse);
}

message ValidateModelGraphRequest {
    model.v1.ModelGraph model_graph = 1;
    DataSpec data_spec = 2;   // 入力の形・タスク・アノテーションの形式
    string dataset_path = 3;  // クラス数を求めるため(Original なら labelmap.txt を読む)
}

// 添字。0 も有効な値なので、Seed と同じくメッセージで包んで「該当なし」と区別する
// (proto3 の optional はシステムの protoc 3.12 では実験フラグが必要なため使わない)
message Index { uint32 value = 1; }

message GraphViolation {
    Index node_index = 1;   // model_graph.nodes の添字
    Index input_index = 2;  // そのノードの inputs の添字
    Index output_index = 3; // model_graph.outputs の添字
    string message = 4;
}

message ValidateModelGraphResponse {
    repeated GraphViolation violations = 1; // 空なら問題なし
}
```

- `node_id` は入れない。位置は添字で決まり、表示用の名前は Rust・フロントがリクエストから引ける
- ポート単位の問題(必須ポートが未接続、モデルの出力の形が合わない)は、添字だけではどのポートか分からないので、`message` の前に「ポート 'x': 」を付ける

### C++(実装済み)

| 場所 | 変更 |
|---|---|
| `src/training/ModelGraphCheck.{hpp,cpp}`(新規) | `checkModelGraph(graph, dataSpec, datasetPath)`。1. `validateGraphStructure()`。問題があればそれだけを返す(閉路などがあると形を計算できないため)<br>2. segmentation なら `validateGraphShapes(graph, {3, input_height, input_width}, クラス数)`、それ以外は `inferGraphShapes()` の問題だけ<br>3. クラス数は `loadDatasetLabelMap(annotation, dataset_path).entryCount()`。読めなければ `DatasetUnreadableError`<br>`loadDatasetLabelMap`(infrastructure)を使うので、`TrainingJob` と同じ合成の層に置いた。段階 4 でも使う |
| `api/grpc/TrainingProtoMapper.{hpp,cpp}` | `toModelGraphCheckRequest()`(層のパラメータの確認は StartTraining と同じ。構造は確かめない)、`fillValidateModelGraphResponse()` |
| `api/grpc/TrainingServiceImpl.{hpp,cpp}` | `ValidateModelGraph`。`_jobManager` には触らない(学習中でも動く) |
| `entities/.../DAG/GraphShapeInference.cpp` | 形の問題にノードの添字(`nodeIndex`)を入れる。これまではノード ID だけで、Rust が `model_graph.nodes[i]` にできなかった。最終出力の問題(チャンネル数 ≠ クラス数など)は、その出力を出しているノードの添字にする |

失敗の扱い:

| 場合 | 応答 |
|---|---|
| グラフに問題がある | OK + `violations` |
| 層のパラメータが不正、`data_spec` がない | `INVALID_ARGUMENT`。Rust が先に確かめているので、起きたら Rust のバグ |
| `labelmap.txt` が読めない | `FAILED_PRECONDITION`(データセットの問題。設定の誤りではない) |
| それ以外の例外 | `INTERNAL` |

### テスト(C++。実装済み・未実行)

- `training_proto_mapper_test`: 依頼の変換(未接続でも例外にしない、層のパラメータが不正・`data_spec` がなければ拒否)、応答の詰め方(添字の 4 通り、ポート名の付け方)
- `model_graph_check_test`(新規): 正しいグラフ、構造の問題だけが返る、途中の層のチャンネル数のずれ、出力チャンネル数 ≠ クラス数(VOC 21)、Original の labelmap.txt からクラス数、labelmap.txt が読めない、classification はクラス数と比べない

---

## 段階 3. Rust から呼ぶ

### 状況(2026-11-26)

コードは書いた。**まだビルドもテストもしていない**(`lr_scheduler` まわりの API と proto の `learning_rate` の移動がつながってから `cargo test --workspace` で確認する)。openapi も更新済み。

| 場所 | 変更 |
|---|---|
| usecases `training/ports.rs` | ポート `ModelGraphValidator::validate_model_graph(&ModelGraph, &DataSpec, dataset_path) -> Result<Vec<ConfigViolation>, ModelGraphValidatorError>` |
| usecases `training/error.rs` | `ModelGraphValidatorError`(`CallFailed` / `DatasetUnreadable` / `Rejected`)。`StartTrainingError` と `ValidateTrainingConfigError` に `GraphCheckFailed`、`ValidateTrainingConfigError` に `DatasetNotFound` / `DatasetReadFailed` |
| usecases `training/config_check.rs`(新規) | `check_training_config()`: 値の検証 → C++ のグラフの検証 → 違反を 1 つにまとめる。新規学習と整合性チェックで共通 |
| adapters `training/grpc_training_starter.rs` | `GrpcTrainingStarter` に `ModelGraphValidator` を実装する(学習の開始と同じ C++ への依頼なので、別のアダプターにしない)。添字から `field` を組み立てる(下の表) |
| usecases `start_training.rs` | `starter` の型に `TrainingStarter + ModelGraphValidator` を求め、`insert_model` の前に `check_training_config()` を呼ぶ。型パラメータは増やさない |
| usecases `validate_training_config.rs` | `ValidateTrainingConfig<R, M, F>`(`M`: `ModelGraphValidator`、`F`: `DatasetFinder`)。データセットを引く → `check_training_config()` → 名前の重複 |
| adapters `http/` | `AppState` の `validate_training` を `ValidateTrainingConfig<V, S, DRD>` にする(S・DRD は学習開始と共有)。ハンドラー・ルーター・`server/main.rs` も合わせる |
| usecases `resume_training.rs` | 呼ばない。`model_graph` と `data_spec` は前回の値に固定されていて、前回の学習開始で確認済みのため |

`field` の組み立て:

| 設定されている添字 | `field` |
|---|---|
| `node_index` と `input_index` | `model_graph.nodes[i].inputs[j]` |
| `node_index` だけ | `model_graph.nodes[i]` |
| `output_index` | `model_graph.outputs[k]` |
| どれもない(ノードが 1 つもない、など) | `model_graph` |

呼ぶ条件:

- 値の違反のうち `model_graph.`(層のパラメータ)か `data_spec.` で始まるものがあれば、C++ は呼ばない。C++ はこれらの値が不正だと依頼ごと拒否する(違反の一覧ではなく `INVALID_ARGUMENT`)ため。それ以外の値の違反(`optimizer.` など)だけなら呼び、グラフの違反と合わせて返す
- C++ からの応答の変換: 通信できない → 502、`FAILED_PRECONDITION`(`labelmap.txt` が読めない)→ 422(データセットの問題)、`INVALID_ARGUMENT` / `INTERNAL` → 500(Rust の検証漏れ・C++ の内部の失敗)

テスト(Rust):

- usecases(実装済み・未実行): グラフの違反があると `insert_model` も `start_training` も呼ばれない。値の違反とグラフの違反が 1 つの一覧で返る。層のパラメータの違反があると `ModelGraphValidator` が呼ばれない。検証できなかったときは `GraphCheckFailed`。グラフの検証に DB のデータセットのパスが渡る。整合性チェックでデータセットがない・読めない
- adapters(実装済み・未実行): 添字から `field` への変換(上の表の 4 通りと添字 0)、gRPC の status の変換、ハンドラーのステータスコード
- 既存の `StartTraining` のテストは、呼び出し順に `validate_model_graph` が入るので期待値を直した

### openapi / フロント(Claude 担当)

- `openapi.yaml`(更新済み): 422 の説明にグラフの違反と `labelmap.txt` が読めない場合を追加。`/trainings/validate` は確認の順番・データセットの確認・502 を追加。`ConfigViolation.field` にグラフの位置の書き方を追加
- フロント(実装済み・未実行。`npm run gen:api` と `vitest` で確認する):
    - `infrastructure/http/config-violations.ts`(新規): 422 の本文の違反を `Issue`(code `training/server-rejected`)にする。位置は送ったリクエストを使って画面の書き方に直す
        - `model_graph.nodes[i]` → `nodeId`(メッセージが「ポート 'x': 」で始まれば `port` も)、`.inputs[j]` → `nodeId` + その入力の `port`、`.spec.<name>` → `nodeId` + `paramName`
        - `model_graph.outputs[k]` / `model_graph` → `field: 'model_graph'`(特定のノードではない)
        - `optimizer.<name>` → `optimizer.<種類>.<name>`、`loss.<name>` → `loss.<種類>.<name>`、`data_spec.<name>` → `data_spec.image.<name>`、`data_spec.image_task_spec.<name>` → `data_spec.image.task_specs.<種類>.<name>`(proto-json の項目名。`validate-training.ts` と同じ)
    - 整合性チェック: `ServerCheck` に `invalid-config`(違反の一覧)を足した。チェックの結果に入るので、ログパネル・ノード(`issuesOfNode`)・プロパティパネル(`paramName`)・学習設定の欄(`field`)に、手元のチェックの結果と同じように出る
    - 学習開始: 422 の違反は `ApiError.issues` に入れ、ログに 1 件ずつ場所付きで出す(整合性チェックの後にデータセットが差し替えられた場合など)
    - `api-client.ts`: エラーの本文を読めるようにした(`callApiByStatus` の `fromErrorBody`、`callApi` の `issuesFromErrorBody`)
    - フロントにあるグラフの検証(`entity/validation/validate-model-graph.ts`)は、エディタ上ですぐに知らせるために残す。最終的な判定はサーバーの結果とする

---

## 段階 4. C++ の学習開始でも形を確かめる

「学習開始前のモデル出力とクラス数の確認.md」の 1. を、段階 2 と同じ関数で行う。Rust が先に確かめるので gRPC の経路では通常起きないが、CLI からの学習と、確認の後にデータセットが差し替えられた場合を防ぐ(device-side assert で ai-engine が使えなくなるのを確実に避けるため)。

- `checkTrainingJobPreconditions()` と `runTrainingJob()` で、段階 2 の関数を呼ぶ。問題があれば `ModelGraphMismatchError`(学習スレッドを起動しない)
- 再開のときは、checkpoint から復元したグラフに対して確かめる

### 状況(2026-11-26)

コードは書いた。**まだビルドもテストもしていない**。

- `TrainingJob.cpp` に `requireTrainableGraph()` を追加。問題をノード ID・ポート付きで 1 つのメッセージにまとめて `TrainingPreconditionError` を投げる
    - `checkTrainingJobPreconditions()`: 新規学習は `command.modelGraph`、再開は `readModelGraphFromCheckpoint()` で読んだグラフを確かめる(モデルは作らない)
    - `runTrainingJob()`: 実際に学習する構造(再開なら復元したもの)を、損失の計算より前に確かめる
- エラーの種類を分けた(2026-11-26)。C++ の例外を 3 つにし、gRPC はどれも `FAILED_PRECONDITION` のまま、トレーラーの `error-reason` で理由を伝える(`training.proto` の TrainingService の説明に一覧)

    | C++ の例外 | `error-reason` | Rust(`StartTrainingError`) | HTTP |
    |---|---|---|---|
    | `TrainingPreconditionError`(checkpoint がない・学習済み) | `resume_precondition` | `ResumePreconditionFailed` | 409 |
    | `ModelGraphMismatchError`(グラフがデータセットに合わない。`requireTrainableGraph`) | `model_graph_mismatch` | `ModelGraphMismatch`(C++ のメッセージ) | 422 + `InvalidConfig`(`model_graph` の違反 1 件) |
    | `DatasetUnreadableError`(色表が読めない。`checkModelGraph`) | `dataset_unreadable` | `DatasetUnreadable` | 422 |

    - `error-reason` がなければ `ResumePreconditionFailed`(古い ai-engine との互換)
    - グラフの不一致が起きやすいのは再開(グラフは checkpoint から復元し、Rust は確かめない)。フロントの再開画面は、422 の違反の一覧を 1 件ずつ出す
    - 読み取りは tonic の `Status::metadata()`(エラーのときはトレーラー、trailers-only ならヘッダーの残りが入る。tonic 0.14.6 の `Status::from_header_map` で確認)
- 確認するテスト: 既存の `training_job_manager_test` / `training_smoke_test`(プリセットのグラフがクラス数と合っていて通ること)

## 決めたこと(2026-11-26)

1. **C++ の学習開始(`TrainingProtoMapper.cpp`)にある値の確認は残す。** Rust が先に確かめるので gRPC の経路では起きないが、CLI と Rust の検証漏れを防ぐ最後の守りにする
2. **整合性チェック API でもデータセットを確かめる。** 形の検証にクラス数が要るため、`/trainings/validate` でもデータセット ID からパスを引く。データセットがなければ 422(openapi の「データセットが登録されているかはここでは確かめない」は段階 3 で直す)

## 対象外

- C++ の学習開始が設定以外の理由(`ABORTED` / `FAILED_PRECONDITION`)で失敗したときに `model` の行が残る問題。`backend-db-remaining.md` の作業 8 で扱う。このissueで、設定の誤りが原因で行が残ることはなくなる
- 学習の途中で起きるエラー(メモリ不足、ラベルマップとマスクの不一致など。「学習開始前のモデル出力とクラス数の確認.md」の 2. / 3.)

## 完了条件

- 不正な値(例: `learning_rate = 0`、`warmup_epochs >= epoch`)で学習開始を送ると 422 と違反の一覧が返り、DB に `model` の行ができず、C++ にも送られない。値を直せば同じ名前で開始できる
- 未接続のポートや閉路のあるグラフ、出力チャンネル数がクラス数と違うグラフでも、同じく 422 と違反の一覧(`model_graph.nodes[...]` などの位置付き)が返る
- 値の違反とグラフの違反が同時にあるとき、両方が 1 つの一覧で返る
- 整合性チェック API でも、同じ違反の一覧が返る。学習中でも使える
- フロントで、違反のある欄やブロックにメッセージが出る

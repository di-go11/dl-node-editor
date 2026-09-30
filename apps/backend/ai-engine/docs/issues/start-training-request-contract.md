# feat: StartTrainingRequest の項目追加と、Rust / C++ での値の制限(proto3 optional を使わない契約)

## 背景

gRPC の `StartTraining` で受け取る `StartTrainingRequest`(`apps/backend/proto/training.proto`)を、C++ のドメインの `StartTrainingCommand`(`application/impl/StartTrainingCommand.hpp`)に変換して `runTrainingJob` に渡す。

現状の `StartTrainingRequest` には、`StartTrainingCommand` にある次の項目がない。

- `dataSpec`(タスクの種類・アノテーション形式・入力サイズ・ignore_index)
- `saveLastEvery`
- `resumeFrom`

また proto3 では、送られなかった数値フィールドは 0 として届き、「未設定」と「0 を明示的に送った」を区別できない。`ignore_index` のように 0 が正しい値にもなり、かつ既定値が 0 でない項目では、送り忘れがエラーにならずに結果だけがおかしくなる(`ignore_index` が 0 になると背景クラスが損失と評価から除外される)。

## 決定事項

- **proto3 `optional` は使わない。** Rust 側で全項目を必ず埋め、範囲を確認してから送る契約にする。C++ 側も、0 だと壊れる値と oneof の指定漏れは `INVALID_ARGUMENT` で拒否する(gRPC は grpcurl などで Rust を経由せずに呼べるため、防御を二重にする)。
- 契約は proto のコメントにも書く(例: `// 必ず設定すること。既定値は 255`)。

### optional を使わない理由(調査結果、2026-09-30)

C++ コンテナの protoc 3.12.4 / grpc_cpp_plugin 1.30.2 で実際に試した。

| 項目 | 結果 |
|---|---|
| protoc 3.12.4(cpp) | `--experimental_allow_proto3_optional` なしではエラー、付ければ生成できる |
| grpc_cpp_plugin 1.30.2 | フラグ付きで生成できる |
| 生成コード(libprotobuf 3.12 ランタイム) | コンパイル・実行とも可。`has_xxx()` で未設定と 0 を区別できる |
| Rust(tonic / prost 0.14、bookworm の protoc 3.21 系) | フラグ不要で `Option<u32>` になる(この環境に cargo がなく未確認) |

`grpc-layer.md` には「protoc 3.12.4 が proto3 optional に非対応のため外した」とあるが、正確には**フラグを付ければ使える**。

使わないことにしたのは、フラグを protoc に渡す手段がないため。CMake 3.22 の `protobuf_generate` には `PROTOC_OPTIONS` がない(3.28 で追加)。回避策は次の 2 つだったが、いずれも見送った。

- protoc をフラグ付きで呼ぶラッパースクリプトを `Protobuf_PROTOC_EXECUTABLE` に指定する
- CMake を 3.28 以上に上げる。Dockerfile の `base` ステージ(dev / ci-agent 共通)の変更が必要。CMakeLists.txt にある FindProtobuf と libtorch(Caffe2)の回避策が壊れるおそれがあり、上げてもフラグ自体は必要なまま

protoc を 3.15 以上に上げればフラグは不要になるが、apt の protobuf / gRPC をソースビルドに置き換える必要があるため見送り。将来 protoc を上げたら、optional の採用を再検討する。

## proto に追加する項目

```proto
message PascalVocConfig { bool include_difficult = 1; }
message ImageAnnotationConfig { oneof config { PascalVocConfig pascal_voc = 1; } }

message SegmentationSpec    { uint32 ignore_index = 1; } // 必ず設定すること。0〜255、既定値は 255
message ObjectDetectionSpec {}
message ClassificationSpec  {}
message ImageTaskSpecs {
    oneof spec {
        SegmentationSpec segmentation = 1;
        ObjectDetectionSpec object_detection = 2;
        ClassificationSpec classification = 3;
    }
}

message ImageSpec {
    ImageAnnotationConfig annotation = 1;
    uint32 input_width = 2;  // 1 以上
    uint32 input_height = 3; // 1 以上
    ImageTaskSpecs task_specs = 4;
}
message DataSpec { oneof spec { ImageSpec image = 1; } }

message StartTrainingRequest {
    // ...既存のフィールド 1〜8...
    DataSpec data_spec = 9;
    uint32 save_last_every = 10; // 0 = 毎エポック
    string resume_from = 11;     // 空なら再開しない
}
```

あわせて既存メッセージのずれを直す。

- `PoolingType` に `POOLING_TYPE_AVERAGE = 2` を追加する(ドメインの `PoolingType` には `Average` がある)

リクエストに**入れない**もの(サーバー側で決める値):

- `ServerConfig`(checkpoint の保存先、スレッド数、処理時間の計測)
- アスペクト比の扱い(`LetterboxPolicy`。`DatasetRepositoryFactory` のコンストラクタで注入)
- CLI 専用の `model_architecture`

## Rust 側で制限する項目

### 1. 未設定(0)のまま送ると困る項目 — 必ず値を入れる

「既定値」は C++ のドメインでの既定値。Rust はこの値を埋めて送る。

| 項目 | 0 のときに起きること | 既定値 | 制限 |
|---|---|---|---|
| `data_spec.image.task_specs.segmentation.ignore_index` | 背景(クラス 0)が損失・評価から除外される。エラーにならない | 255 | 必ず送る。0〜255 |
| `data_spec.image.input_width` / `input_height` | リサイズが壊れる | 256 | 1 以上 |
| `epoch` | 1 エポックも学習しない | 1 | 1 以上 |
| `batch` | バッチが作れない | 1 | 1 以上 |
| Adam / AdamW の `beta1`, `beta2` | Adam として意味のない設定になる | 0.9 / 0.999 | 0 以上 1 未満 |
| Adam の `eps` | 0 除算のおそれ | 1e-8 | 0 より大きい |
| 各 Optimizer の `learning_rate` | 学習が進まない | 0.001 | 0 より大きい |
| `combo.alpha` | Dice 項だけになる | 0.5 | 0〜1 |
| `focal.gamma` / `focal.alpha` | alpha が 0 だと損失が 0 | ドメインに既定値なし | gamma ≥ 0、alpha 0〜1 |
| BatchNorm の `eps` / `momentum` | eps が 0 だと 0 除算のおそれ | 1e-5 / 0.1 | eps > 0、momentum 0〜1 |

`save_last_every` は 0 が正しい値(毎エポック保存)なので、未設定でも問題ない。

### 2. 選択肢の指定漏れ

| 項目 | 制限 |
|---|---|
| `data_spec`・`annotation`・`task_specs`・`optimizer`・`loss`・各 `LayerConfig` の oneof | どれか 1 つを必ず設定する |
| `PoolingType`・`ActivationType` | `*_UNSPECIFIED`(0)を送らない |

### 3. 値の範囲

| 項目 | 制限 |
|---|---|
| Conv2D | in/out channels ≥ 1、kernel_size ≥ 1、stride ≥ 1、padding ≥ 0、dilation ≥ 1 |
| Pooling / IndexedPooling / Unpooling | kernel_size ≥ 1、stride ≥ 1、padding ≥ 0 |
| BatchNorm / Linear | num_features、in/out features ≥ 1 |
| `weight_decay`、SGD の `momentum` | 0 以上 |
| `model_graph.layers` | 空にしない |

### 4. 文字列

| 項目 | 制限 | 理由 |
|---|---|---|
| `model_name` | 空にしない。英数字・`-`・`_` のみ | checkpoint のファイル名(`<model_name>_last.pt`)に使われる。`../` などで保存先の外に書き込めてしまう |
| `device` | `cpu` / `cuda` / `cuda:N` | Capabilities が返したデバイスから選ばせる(Rust にはすでに Capabilities のドメインがある) |
| `dataset_path` | 空にしない | 存在確認は Rust ではできないので C++ で行う |
| `resume_from` | 空なら再開しない。指定時は `dataset_path` と同じ扱い | サーバー上のパスなので、許可ディレクトリ外を読ませない仕組みが C++ に必要 |

## C++ 側に残す確認

Rust を経由しない呼び出しへの防御と、サーバー上のデータがないとわからない確認。

- **最低限の拒否(`INVALID_ARGUMENT`)**: 上の「0 のまま送ると困る項目」のうち 0 だと壊れるもの(入力サイズ、epoch、batch、learning_rate、eps など)と、oneof / enum の指定漏れ
  - `ignore_index` は 0 も正しい値なので、C++ では拒否できない。Rust 側の契約で担保する
- **パス**: `dataset_path` / `resume_from` が存在するか、許可ディレクトリの配下か
- **クラス数との整合**: モデル最終層の出力チャンネル数 = labelmap のクラス数
- **層のつながり**: 前の層の out channels と次の層の in channels の一致、Pooling / Unpooling の対応
- **入力サイズ**: Pooling の段数で割り切れるか(SegNet なら 5 段なので 32 の倍数)

## タスク

### 完了

- [x] `training.proto` に `DataSpec` 関連のメッセージ、`save_last_every`、`resume_from` を追加する(`6d43f64`)
- [x] `PoolingType` に `POOLING_TYPE_AVERAGE` を追加する(`6d43f64`)
- [x] 契約(必ず設定する項目・範囲)を proto のコメントに書く(`6d43f64`)
- [x] C++: `StartTrainingRequest` → `StartTrainingCommand` の変換を gRPC 層に実装する(`88b304e`、`api/grpc/TrainingProtoMapper`)
- [x] C++: 変換時の最低限の拒否(0 と oneof / enum の指定漏れ)を `INVALID_ARGUMENT` で返す(`88b304e`)
  - あわせて `model_name` の文字種(英数字・`-`・`_`)と `device` の形式も確認している
- [x] C++: `TrainingService`(StartTraining / StreamProgress / StopTraining)とジョブ管理(`TrainingJobManager`)を実装する(`88b304e`)

### C++ 側(残り)

- [ ] `dataset_path` / `resume_from` の許可ディレクトリ確認
  - 許可ディレクトリをサーバー側の設定に持たせ、StartTraining の変換時に「存在する」「許可ディレクトリの配下である」を確認する。`..` やシンボリックリンクで外に出られないよう、正規化したパスで比べる
  - NG は `INVALID_ARGUMENT`(存在しないものは `NOT_FOUND` にするかも決める)
- [ ] クラス数・層のつながり・入力サイズの整合確認(学習開始前)
  - クラス数: モデル最終層の出力チャンネル数 = labelmap のクラス数
  - 層のつながり: 前の層の out channels と次の層の in channels の一致、IndexedPooling / Unpooling の対応(個数と順番)
  - 入力サイズ: Pooling の段数で割り切れるか(SegNet なら 5 段なので 32 の倍数)
  - labelmap はサーバー上のデータセットにあるため、StartTraining の変換時ではなく、`runTrainingJob` の組み立て時に確認することになる。現状、この時点の失敗はジョブの `FAILED` として StreamProgress で返る。StartTraining の時点で `INVALID_ARGUMENT` にしたいなら、labelmap の読み込みをジョブ開始前に行う必要がある
- [ ] サーバー側の設定の持ち方を決める
  - 現状(`GrpcApp::loadServerConfig`)は、カレントディレクトリに `.config` があればそのサーバー設定(checkpoint の保存先・スレッド数・処理時間の計測)を流用し、なければ既定値を使う暫定の形
  - `.config` にはジョブの依頼の項目も同居しており、`--serve` でも全項目が正しくないと読み込みで失敗する
  - gRPC サーバー用の設定ファイルを分けるか、環境変数・起動引数で渡すかを決める。上の許可ディレクトリもここに持たせる
- [ ] `FocalLossConfig` にドメイン側の既定値を持たせる(現状は未初期化)

### Rust 側(残り)

- [ ] 既定値を埋めて `StartTrainingRequest` を組み立てる
  - 上の「1. 未設定(0)のまま送ると困る項目」の既定値(`ignore_index` = 255、入力サイズ = 256、Adam の beta1 / beta2 / eps など)を必ず入れる
- [ ] 上の 1〜4 の制限を送信前に確認する
  - `device` は Capabilities が返したデバイスから選ばせる
- [ ] `TrainingService` のクライアントを実装する(StartTraining / StreamProgress / StopTraining)
  - gRPC のステータス: `INVALID_ARGUMENT`(値が不正)、`FAILED_PRECONDITION`(ほかのジョブが実行中)、`NOT_FOUND`(存在しない `job_id`)
  - StopTraining の戻り値はまだ `RUNNING` のことがある。実際に止まったかは StreamProgress の `STOPPED` で判断する
  - StreamProgress は終了の状態(`COMPLETED` / `FAILED` / `STOPPED`)を送ったら閉じる。`epoch` は終了したエポック数で、1 エポックも終わっていない間は 0(`metrics` は未設定)
- [ ] proto の変更後に `cargo build` が通ることを確認する(C++ 側の環境に cargo がなく未確認)

## 進捗メモ(2026-09-30、C++ 側)

grpcurl で実データ(`TrainingDataset/train`、Conv 1 層、CPU)を使って確認した。

- StartTraining → StreamProgress: `RUNNING`(epoch 0)→ epoch 1 → epoch 2 → `COMPLETED` の順に届き、ストリームが閉じる
- 実行中の StartTraining は `FailedPrecondition`、不正なリクエストは `InvalidArgument`、存在しない `job_id` の StopTraining は `NotFound`
- StopTraining: 2 エポック目の途中で要求 → そのエポックを終えてから `STOPPED`。抜けたエポックの `last` checkpoint は保存される

既知の制限:

- 停止はエポックの区切りでしか効かない。1 エポックが長いと StopTraining が効くまで時間がかかる。バッチごとに止めるには `IModelTrainer::trainOneEpoch` などに停止フラグを渡す必要がある
- StreamProgress は最新の状態だけを送る。送信が遅れている間に 2 エポック分の更新があると、途中の 1 つは飛ばされる(エポックは十数秒以上かかるため、実際にはまず起きない)

## 未決定事項

- `dataset_path` / `resume_from` の許可ディレクトリをどこで設定するか(`ServerConfig` に持たせるのが候補)
- 将来、パスではなく ID や名前でデータセット・checkpoint を指定する形にするか
- 入力サイズの上限を設けるか(GPU メモリ不足の防止)

## 参考: レスポンス側のずれ(解消済み)

`StreamProgressResponse` の `SegmentationMetrics` に `fw_iou` / `mean_class_accuracy` / `per_class_iou` を追加し、`ClassificationMetrics` を `oneof metrics` に入れた(`6d43f64`)。フィールド名は `val_` を外して `pixel_acc` / `miou` に揃えた。

## 関連

- `model-config-and-training-rpc.md`(学習 RPC 全体の方針。「5. エラー表現」の INVALID_ARGUMENT 方針)
- `grpc-layer.md`(proto3 optional を外した経緯。上の調査結果で補足)
- `training-api-setup.md`(Rust 側)
- `validation.md`

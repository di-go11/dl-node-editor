# feat: ModelGraph の DAG 化 — 進捗と残りのタスク

ブランチ: `feat/DAG-struct`
設計と経緯: `model-graph-dag.md`(ADR)。この issue は、その実装の進み具合と、これからやることをまとめる。

## 現在の状態(2026-10-01、`3c196cf` 時点)

**`ai_engine_lib`(`src/training/`)と、gRPC に関係しないテストはビルドできる。** `ModelGraph` を使う側を DAG に追従させる「B. ビルドの復旧」のうち、a〜h と、j の gRPC に関係しないテストが完了した。

**gRPC 側(タスク i)は未対応で、ここがまだビルドできない。** `ai_engine_proto`(`model_graph.proto` を CMake に登録していない)、`TrainingProtoMapper`、`TrainingServiceImpl`、`GrpcApp`、`ai_engine_app`、`training_proto_mapper_test`。そのため、**`ctest` が通っても `training_proto_mapper_test` の結果は信用できない**(ctest はビルドをしないので、ビルドが失敗しても古い実行ファイルを動かして Passed と出る)。

### 確認できたこと / まだ確認できていないこと

| | 内容 |
|---|---|
| 確認できた | `cmake --build build -j2 --target ai_engine_lib` が通る(`4dd7420`) |
| 確認できた | `model_graph_golden_test` の 8 項目がすべて一致する。`TorchModel` を DAG のインタプリタに書き換えても、初期重み・出力・各ステップの loss・学習後の出力が変わっていない(学習後の出力の合計は期待値 `-117.57355…` に対して `-117.57352…`。許容内)。層を `nodes` の並び順で作ったので、重みの初期値が変わらない |
| 確認できた | 実行して通ったテスト: `model_graph_golden_test`、`model_graph_archive_test`、`checkpoint_roundtrip_test`、`checkpoint_rebuild_test`、`device_parity_test`(CPU のみ。CUDA 側は未確認)、`graph_shape_inference_test`、`torch_seed_recall_test` |
| **未確認** | `training_smoke_test` は、実データ(`TrainingDataset/train`)がなくスキップされた。ビルドは通るが、学習が通ることは確認できていない |
| **未確認** | CLI でプリセット(特に SegNet)を実際に組み立てて学習すること。`buildGraph` は `ValidatedModelGraph::create` を通すので、組み立てのミスは学習の前に例外になるはずだが、SegNet で実行して確かめてはいない |
| **未確認** | checkpoint の保存と再開(CLI での一連の流れ) |

### 決めたこと

- **`StartTrainingCommand::modelGraph` は `std::optional<ValidatedModelGraph>`。** `IModelFactory::create` は `const ValidatedModelGraph &` を受け取る。
  - `ValidatedModelGraph` は `create` からしか作れないので、「値が入っていれば検証済み」を型で保証できる(不正な状態を表現できなくする)。エラーが出るのは、モデルを作る時点ではなく、リクエストの変換や CLI のプリセットを組む時点になる
  - デフォルト構築ができないので、「未設定」を `optional` の `nullopt` で表す。`StartTrainingCommand command;` と宣言してからフィールドを埋める既存の書き方と両立する。`TrainingJob` は `has_value()` で未設定を例外にする
- **checkpoint まわりは、データとしての `ModelGraph` のまま。** `RestoredCheckpoint::graph` と `TorchCheckpointStore` は `ModelGraph` を持ち、`CheckpointModelLoader` が、読んだグラフを `create` で検証してからモデルを組む(ファイルは外から来る入力のため)。
- **fingerprint の文字列は v2。** ノードは `nodes` の並び順のまま書く(実行順に直さない)。重みの初期値と `parameters()` の順番が並び順で決まるため。ノード ID、入力の接続、`outputs` を含める。
- **`ModelGraphBuilder`(新規、`DAG/ModelGraphBuilder.hpp`)は検証しない。** `build()` が返すのは検証前の `ModelGraph` で、`ValidatedModelGraph::create` が検証する(検証の責務を 1 か所に集める)。`add(layer)` は直前のノードの `y` を `x` につなぎ、`add(layer, inputs)` は入力を明示する(SegNet の `indices`)。

### 完了したもの(コミット別)

- [x] `136e066` 形状推論(C)とポートの検証(A の一部): `GraphShapeInference` / `LayerShapeRules` / `PortShape`、`tests/graph_shape_inference_test.cpp`
- [x] `4dd7420` B の a〜h: fingerprint v2、`ValidatedModelGraph` への型の変更、`ILayer::forward` の変更と `IIndicesSource` / `IIndicesSink` の削除、`TorchModel` の DAG 化、archive v3、`ModelGraphBuilder` とプリセットの DAG 化
- [x] `3c196cf` B の j(一部): gRPC に関係しないテストを新しい形に直した。`model_graph_archive_test` は、fingerprint の既知値(v2 の文字列に対する `7905992374f76ef3`)と archive のキー集合を更新し、ノード ID・接続・`outputs` の復元と、v2 以前の format の拒否の確認を足した

### 完了したもの(`bdc292a` まで)

- [x] 変更前の計算結果を記録するテスト(`tests/model_graph_golden_test.cpp`、`2c50f64`)
  - 小さい SegNet 型のグラフを CPU・固定 seed で動かし、構築直後のパラメータ、順伝播の出力、学習 3 ステップの loss、学習後の出力を期待値と比べる
  - 期待値は線形リスト版のコードで取得した。DAG 化の後も値を変えないこと
- [x] ModelGraph 関係のファイルを `entities/domain-objects/ModelGraph/` にまとめた(`41b64aa`。移動と include の書き換えだけ)
- [x] proto: 層とグラフの定義を `model_graph.proto`(パッケージ `model.v1`)に分け、`ModelGraph` を `nodes` / `outputs` にした(`bdc292a`)
- [x] entities: `GraphNode` / `NodeInput` / `PortRef` を追加し、`ModelGraph` を `nodes` / `outputs` にした(`bdc292a`)
- [x] entities: `ValidatedModelGraph`(検証とトポロジカルソートを通ったグラフ。`create` からしか作れない)(`bdc292a`)
  - 検証: ノードが空、ID が空・重複・文字種、参照先が存在しない、`outputs` の不備
  - トポロジカルソート: Kahn 法。同順位は `nodes` の並び順。閉路は例外
- [x] entities: 層の種類ごとのポートの定義(`Layers/LayersPort.hpp`)(`bdc292a`)
  - 既存の 7 種類と、variant から引く入口 `layerPortsOf(const LayersConfig &)`
  - これから追加する層(`*Params` は前方宣言のみ): Add / Concat / Upsample / ConvTranspose2D / AdaptiveAvgPool / Dropout / Flatten / GroupNorm、PatchEmbedding / TokensToFeatureMap / PositionalEncoding / LayerNorm / SelfAttention / MultiHeadAttention / TransformerEncoderLayer / TransformerDecoderLayer

### ADR から変わった点

| 項目 | ADR の記述 | 実際 |
|---|---|---|
| ブランチ | `feat/model-graph-dag` | `feat/DAG-struct` |
| 置き場所 | `entities/graph/`、`domain-objects/GraphNode.hpp`、`domain-objects/LayerPorts.hpp` | `domain-objects/ModelGraph/DAG/`、`domain-objects/ModelGraph/Layers/LayersPort.hpp` |
| 進める順番 | C++ のドメイン → proto | proto を先に変更した(そのため、今はビルドできない) |
| proto のパッケージ | `training.v1` の中 | 層とグラフは `model.v1`(`model_graph.proto`)に分けた |
| 検証の結果の持ち方 | 関数 `validateGraph` | 型 `ValidatedModelGraph`(検証済みであることを型で表す) |
| 旧形式の checkpoint | 読めるようにする | 読まない(「未対応の古いフォーマット」の例外にする) |
| mapper の一時的な形 | 線形の proto を `linearToGraph` で DAG にする | 不要(proto の `Node` を `GraphNode` に直接詰め替える) |

### 今のディレクトリ構成

```
src/training/entities/domain-objects/ModelGraph/
├── ModelGraph.hpp                  nodes / outputs
├── ModelGraphFingerprint.{hpp,cpp} 正規化文字列は v2(nodes と接続を含む)
├── PortShape.hpp                   形状(C, H, W)
├── DAG/
│   ├── GraphNode.hpp               PortRef / NodeInput / GraphNode
│   ├── GraphValidation.{hpp,cpp}   GraphValidationError / ValidatedModelGraph
│   ├── GraphShapeInference.{hpp,cpp} 形状推論(validateGraphShapes)
│   ├── ModelGraphBuilder.hpp       層を足していって ModelGraph を組み立てる(検証はしない)
│   └── NodeChecker.hpp             ノード ID の文字種の確認
└── Layers/
    ├── LayersConfig.hpp / LayersParams.hpp / LayersParamsFields.hpp
    ├── LayersPort.hpp / PortKinds.hpp / LayerShapeRules.hpp
    └── 各層の *Params.hpp、ActivationConfig / ActivationType、PoolingType
```

## 残りのタスク

A → B の順に進める。A のポートの定義は、B の `TorchModel` でも使う。

### A. 検証まわり(entities)

- [x] **ノード ID の文字種を「使える文字だけを許す」方式にする**(`DAG/NodeChecker.hpp`)(済み: 英数字・`-`・`_` だけを通す。空は `false`、上限は 64 文字)
  - 今は禁止する文字を並べる方式で、`;` `[` `]` `=`、日本語、制御文字などが通る。fingerprint の正規化文字列が `;` `:` `|` `[` `]` を区切りに使うため、少なくともこれらは通してはいけない
  - `validateGraphStructure` のエラーメッセージは「英数字・`-`・`_` のみ」と書いているので、実装をそれに合わせる(`std::isalnum` または `-` `_`)
  - ID が空のときに例外を投げているのをやめ、`false` を返す(空の確認は `validateGraphStructure` 側にある)
  - 長さの上限を決める(例: 64 文字)
- [x] **`PortKind` の扱いを決める**(照合する。`InputPortSpec` に `kind` を持たせ、`Tokens`(トークン列)と `Any`(種類を問わない。Activation / Dropout / Add など)を足した)
  - 今は `OutputPortSpec` にだけ `kind` があり、`InputPortSpec` にはない。照合する相手がないので、このままでは使い道がない
  - 照合する場合: `InputPortSpec` の `name` の次に `PortKind kind = PortKind::Feature;` を足し、Unpooling の `indices` 入力を `PortKind::Indices` にする(Add / Concat の定義は引数の位置が 1 つずれる)
  - 照合しない場合: `OutputPortSpec::kind` と `PortKinds.hpp` を外す
  - Transformer 系を入れるなら `Tokens`(トークン列 `(N, L, D)`)を足す。Conv の出力を PatchEmbedding を通さずに Attention へつなぐ間違いは、名前では検出できない
- [x] **グラフ入力を指すときの `PortRef.port` の値を決める**(決定: **空文字**。`nodeId` も `port` も空 = グラフ入力。入力は 1 つだけなので名前で区別せず、`port` が空でなければ検証でエラー。将来入力が複数になっても、空 = 既定の入力として残したまま名前付きの入力を足せる)(`nodeId` が空のとき。空にするか、`"image"` のような固定の名前にするか)。決めた値以外は検証でエラーにする
- [x] **ポート名の検証を `validateGraphStructure` に足す**(`layerPortsOf` と突き合わせる。`validateGraphPorts`、`tests/graph_shape_inference_test.cpp` で確認)
  - 入力ポート名が、その層のカタログにある
  - 必須のポートがつながっている(`minCount`)
  - 可変長でないポートに 2 本以上つないでいない
  - 参照先の出力ポート名が、参照先の層のカタログにある(`indices` を IndexedPooling 以外から取ろうとする間違いを検出する)
  - `outputs` のポート名が、そのノードの出力ポートにある
  - (`PortKind` を照合する場合)出力の種類と入力の種類が一致する
- [x] **`validateGraphStructure` をヘッダで公開し、閉路も `errors` に入れる**(`GraphValidation.hpp` で公開。`validateAndSort` が構造のエラーがないときだけソートし、閉路を `errors` に入れる。`tests/graph_shape_inference_test.cpp` で確認)
  - 今は無名名前空間の中にあり、閉路だけが `topologicalSort` の例外として出る
  - `topologicalSort` を「並べられた分の `order` を返す」形にし、ほかのエラーがないときだけソートを試して、`order.size() != n` なら `errors` に追加する
  - 検証のテストが `errors` の中身で書けるようになり、mapper の `INVALID_ARGUMENT` や、将来の「検証だけする RPC」でそのまま使える
- [x] クラス名を `ValidatedModelGraph` にする(ほかの型は大文字始まり)。`GraphValidation.cpp` の include を `training/entities/...` から始まる形にする(任意)(改名は済み。include は相対のままにすると決めた)
- [ ] **テスト `tests/model_graph_test.cpp` を追加する**(libtorch に依存しない)

  | ケース | 期待する結果 |
  |---|---|
  | 一直線(`[A, B, C]`) | `order = [0, 1, 2]` |
  | 並びが実行順と逆(`[C, B, A]`) | `order = [2, 1, 0]` |
  | 分岐と合流(`[A, C, B, D]`) | `order = [0, 1, 2, 3]`(同順位は添字の小さい順) |
  | 同じノードを 2 つのポートにつなぐ | 閉路と誤判定しない |
  | 閉路 | エラー。実行できないノードの ID が入る |
  | ID の重複 / 文字種 / 空 | エラー |
  | 存在しない参照先、`outputs` が 0 個・2 個・参照先なし | エラー |
  | 未知のポート名、必須ポートの未接続、同じポートへの重複接続 | エラー |
  | 各層の `layerPortsOf` | 表のとおりのポートが返る |

### B. ビルドの復旧(`ModelGraph` を使う側を DAG に対応させる)

内側の層から順に直す。`src/training/` は全体で 1 つのライブラリ(`ai_engine_lib`)なので、a〜h が終わるまでライブラリはビルドできない。

- [x] **先に決める: `StartTrainingCommand` と `IModelFactory::create` が受け取る型**(決定: `ValidatedModelGraph`。`StartTrainingCommand` では `optional` で持つ。「現在の状態」の「決めたこと」を参照)
  - `ValidatedModelGraph` にする(検証を通していないグラフではコンパイルが通らない。mapper・CLI のプリセット・checkpoint の読み込みが、それぞれ `create` を呼ぶ)← 推奨
  - `ModelGraph` のままにして、`TorchModel` のコンストラクタで `create` を呼ぶ(変更は少ないが、エラーが出るのがモデルを作る時点まで遅れる)
- [x] a. `ModelGraph/ModelGraphFingerprint.cpp`: `graph.nodes` を回す。正規化文字列にノード ID、入力の接続、`outputs` を足し、先頭を `v2;` にする
- [x] b. `application/impl/StartTrainingCommand.hpp`、`adapters/interfaces/IModelFactory.hpp`: 上で決めた型に合わせる
- [x] c. `adapters/interfaces/ILayer.hpp`: `forward` を `std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs)` にする(並びは `layerPortsOf` のポート順)。`IIndicesSource.hpp` / `IIndicesSink.hpp` を削除する
- [x] d. `infrastructure/torchFunc/Torch*Layer.{hpp,cpp}`(7 種類): 新しい `forward` に合わせる
  - 5 種類は `{_module->forward(inputs[0])}` を返すだけ
  - `TorchIndexPoolingLayer` は `{pooled, indices}` を返す。`TorchUnpoolingLayer` は `inputs[0]`(x)と `inputs[1]`(indices)を受け取る
  - `_lastIndices` / `takeIndices` / `provideIndices` を削除する
- [x] e. `infrastructure/torchModel/TorchModel.{hpp,cpp}`: DAG のインタプリタにする
  - 層は **`nodes` の並び順**で作る(`getOrder()` の順ではない)。重みの初期値と `parameters()` の順番がこれで決まる
  - 構築時に、接続を添字に直して持つ(入力ごとに「グラフ入力か」「どのノードの何番目の出力か」)。ポート名から位置を引くのに `layerPortsOf` を使う
  - `forward`: `getOrder()` の順に回し、ノードごとの出力を表に入れて受け渡す。最後に `outputs[0]` が指すテンソルを返す
  - LIFO スタック、`_useIndices`、`dynamic_cast` を削除する
- [x] f. `infrastructure/torchModel/ModelGraphArchive.{hpp,cpp}`: format を v3 にする
  - 保存するもの: ノード数、各ノードの ID・層(今の `writeLayer` を流用)・入力の接続、`outputs`
  - v2 以前は「未対応の古いフォーマット」の例外にする
- [x] g. 型の変更への追従: `CheckpointArchiveIO.cpp`、`CheckpointModelLoader.cpp`、`TorchCheckpointStore.cpp`、`TorchModelFactory.cpp`、`TrainingJob.cpp`(`layers.empty()` → `nodes.empty()`)。checkpoint から読んだグラフも `create` を通す
- [x] h. `TrainingApp.cpp`: プリセット(Sample / SegNet / SegNetDilated / SegNetFullDilated)を DAG で組み立てる
  - 層を順に足していくビルダーを entities に作る(`add(layer)` は直前の `y` を `x` につなぐ。`add(layer, inputs)` で入力を明示する。`build()` は最後のノードの `y` を `outputs` にする)
  - SegNet は、encoder の IndexedPooling のノード ID を覚えておき、decoder の Unpooling の `indices` に明示的につなぐ
- [x] i. gRPC(「D. proto / gRPC」を参照)(C++ 側は完了、`6094066`。grpcurl での確認と Rust は D に残っている)
- [x] j. テスト: グラフの組み立てを新しい形に直す(`model_graph_golden_test` は `makeGraph()` と `appendConvReluBn()` だけ。ノードを並べる順番は今の層の順番と同じにし、`kExpected*` は変えない)。ほかに `model_graph_archive_test`、`checkpoint_rebuild_test`、`checkpoint_roundtrip_test`、`device_parity_test`、`training_smoke_test`、`training_proto_mapper_test`
  - 完了(`3c196cf`): `model_graph_golden_test`、`model_graph_archive_test`、`checkpoint_rebuild_test`、`checkpoint_roundtrip_test`、`device_parity_test`、`training_smoke_test`(ただし smoke は実データなしでスキップされ、学習が通ることは未確認)
  - 完了(`6094066`): `training_proto_mapper_test`

**確認の節目**

1. a〜h の後: `cmake --build build -j2 --target ai_engine_lib` が通る(**済み**、`4dd7420`)
2. `model_graph_golden_test` の値が一致する(**ここが一番大事**。`TorchModel` の書き直しで計算結果が変わっていないことの確認)(**済み**、`4dd7420`)
3. i の後: `ai_engine_app` と `training_proto_mapper_test` がビルドできる(**済み**)
4. j の後: 全テストが通り、CLI で SegNet を 1 エポック学習して、checkpoint の保存と再開ができる

### C. 形状推論による検証

- [x] `validateGraphShapes(graph, 入力の C / H / W, クラス数)` を entities に追加する(`DAG/GraphShapeInference.{hpp,cpp}`、層ごとの規則は `Layers/LayerShapeRules.hpp`。Linear は最後の次元に作用する。最終出力の H / W = 入力の H / W も確認する)
  - 層ごとの規則: Conv2D / Pooling は PyTorch の出力サイズの式(dilation を含む)、Unpooling は `(H-1)*stride - 2*padding + kernel`、BatchNorm は `num_features == C`、Linear は最後の次元 `== in_features`
  - 確認: 前の層の出力チャンネル数 = Conv2D の `in_channels`、Unpooling の `x` と `indices` の形状が一致、出力サイズが 1 以上、最終出力のチャンネル数 = クラス数
- [ ] `runTrainingJob` で、labelmap を読んでクラス数が決まった直後(モデルを組み立てる前)に呼ぶ
- [x] テスト `tests/graph_shape_inference_test.cpp`(CLI のプリセットが 256×256 で通る。チャンネル数・Unpooling の形状・クラス数の不一致を検出する)
- 副産物: 各ノードの出力形状がわかるので、`docs/重みと計算量の見積もり.md` の計算(学習時の活性化のメモリ)を自動化でき、batch_size の目安を出せる

### D. proto / gRPC

proto の定義は完了している。残りは C++ 側の対応。

- [x] `CMakeLists.txt` の `ai_engine_proto` に `${PROTO_DIR}/model_graph.proto` を足す
- [x] `TrainingProtoMapper.cpp`: 層とグラフの型を `training::v1::` から `model::v1::` に変える(16 か所)。`toModelGraph` を、proto の `Node` → `GraphNode` の詰め替えに書き直す
  - エラー位置の表記を `model_graph.nodes[3](id=enc2_pool).inputs[1]` のようにする
  - 検証のエラーは `INVALID_ARGUMENT` に変換する
- [x] `training_proto_mapper_test`: 正常な DAG、未接続ポート、閉路、存在しない参照先のケースを足す
- [x] `model_graph.proto` のコメントに契約を書く(ノード ID の文字種、`outputs` は当面 1 つ、`source.node_id` が空ならグラフ入力)。見出し `// ----Merge----` を中身に合う名前にする
- [ ] grpcurl で SegNet 相当の DAG を送り、学習が完了まで進むことを確認する。送った JSON を `configs/segnet_dag.json` に置く(Rust と GUI を作るときの見本)
- [ ] Rust: `api/crates/adapters/build.rs` のリストに `model_graph.proto` を足し、`cargo build` が通ることを確認する

### E. 層の追加

層ごとに: `Layers/*Params.hpp`、`LayersParams.hpp` の include、`LayersConfig.hpp` の variant、`LayersParamsFields.hpp`(`LayerKind` は末尾に追加、`layerKindOf`、`visitLayerFields`)、形状の規則、`Torch*Layer`、`TorchLayerBuilder`、proto の `LayerConfig`、mapper、テスト。ポートの定義は `LayersPort.hpp` に書いてある。`ModelGraphArchive` の `static_assert` の要素数も更新する。

- [ ] **第 1 段(分岐と合流を動かす)**: Add、Concat、Upsample
  - `ModelArchitectureType` に `UNetSmall` を追加し(encoder 3 段 + decoder 3 段、concat の skip connection)、CLI と grpcurl の両方で学習できることを確認する
- [ ] 第 2 段(必要になったら): ConvTranspose2D、AdaptiveAvgPool、Dropout、Flatten、GroupNorm
- [ ] 第 3 段(Self-Attention / Transformer): PatchEmbedding、TokensToFeatureMap、PositionalEncoding、LayerNorm、SelfAttention、MultiHeadAttention、TransformerEncoderLayer、TransformerDecoderLayer
  - 前提: 形状推論でトークン列 `(L, D)` を扱えること、`PortKind::Tokens` による接続の確認
  - `ActivationType` に GELU を足す
  - DETR のような検出では出力が複数(クラスとボックス)になるため、「出力は 1 つ」の制限を外す設計が別に必要

### F. ドキュメント

- [ ] `model-graph-dag.md`: 置き場所とブランチ名を実際の構成に合わせる(上の「ADR から変わった点」)
- [ ] `model-config-and-training-rpc.md`: 「config スキーマの表現方針」の節を ADR への参照に置き換える
- [ ] `start-training-request-contract.md`: 「層のつながり」「Pooling / Unpooling の対応」「入力サイズ」の確認項目を、C の形状推論で完了済みにする。proto の例を `model.v1` と `nodes` の形に直す
- [ ] `.config` の `model_architecture` のコメントに `SegNetDilated` / `SegNetFullDilated` / `UNetSmall` を追記する
- [ ] `開発ロードマップ.md` の「model config のグラフ表現」を更新する
- [ ] `add-ml-component` スキルの手順に、`LayersPort.hpp` への追加を足す

### G. このブランチの後(別の issue)

- [ ] Rust: `training.proto` のクライアント、既定値の埋め込み、送信前の構造チェック(GUI で早く知らせるため。C++ の検証は、Rust を通らない経路 — grpcurl、CLI のプリセット、checkpoint の読み込み — のために残す)
- [ ] フロントエンド: ノードエディタ(React Flow を想定)→ proto の `ModelGraph` への変換。座標などの GUI だけの情報は別に保存する。残差ブロックのような「よく使う組み合わせ」は GUI のテンプレートとして持ち、基本の層に展開してから送る
- [ ] Capabilities: `LayersPort.hpp` の定義と各層の params の定義を返す RPC を追加し、GUI の部品一覧と設定フォームをそこから作る(層の定義を C++ と GUI で二重に持たないため)

## 決めること(一覧)

| 決めること | 関係するタスク |
|---|---|
| `PortKind` で接続の種類を照合するか | A |
| グラフ入力を指すときの `PortRef.port` の値 | A |
| ノード ID の長さの上限 | A |
| `StartTrainingCommand` / `IModelFactory::create` が受け取る型 | B(決定済み: `ValidatedModelGraph`) |
| 複数の出力と Loss の対応(検出ヘッド、DETR) | E の第 3 段より前 |

## 注意点

- **移行後は、既存の checkpoint(format v2)が読めなくなる。** `output_dir` に古い `<model_name>_last.pt` が残っていると自動再開で失敗するので、移行後に最初の学習を回す前に、退避するか `model_name` を変える
- `model_graph_golden_test` の期待値は、この devcontainer で取得した。許容誤差は 1e-4。Jenkins やサーバーで落ちた場合は、誤差の大きさを見て許容値を調整する
- `bdc292a` はビルドできないコミットだった。`4dd7420` 以降は `ai_engine_lib` がビルドできるが、**gRPC 側(i)が終わるまで、`ai_engine_app` を含む全体のビルドと CI は失敗する**
- **`ctest` はビルドをしない。** ビルドに失敗したテスト(今は `training_proto_mapper_test`)は、古い実行ファイルで動いて Passed と出ることがある。結果を見る前に、`cmake --build build -j2 -- -k 0` で失敗したターゲットがないか確認する
- **`training_smoke_test` は、実データがないとスキップされる**(終了コードは 0 になる)。CI では、`TrainingDataset/train` を用意しないと、学習が通ることを確認できない
- この変更で、fingerprint が v2、archive が v3 になった。**これまでの `.pt` は、再開に使えない**(上の注意と同じ)

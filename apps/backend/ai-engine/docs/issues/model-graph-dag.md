# ADR: モデル定義の内部表現を線形リストから DAG(ノード+入力参照)に変える

**Status:** Accepted(2026-10-01。分岐と合流は必要な機能と確認)
**Date:** 2026-10-01
**決める人:** プロジェクトオーナー
**関連:** `model-config-and-training-rpc.md`(グラフ表現の初期方針)、`start-training-request-contract.md`(proto の契約)、`checkpoint-rebuild.md`(グラフの checkpoint 保存)

## 背景

### 今の表現

- ドメイン: `ModelGraph { std::vector<LayersConfig> layers; }`。`LayersConfig` は `std::variant<Conv2DParams, PoolingParams, ...>`
- proto: `ModelGraph { repeated LayerConfig layers; }`。`LayerConfig` は `oneof params` で層の種類ごとに型付きの message
- 実行(`TorchModel::forward`): 層を順に呼び、「前の層の出力 = 次の層の入力」。SegNet の pooling indices は `IIndicesSource` / `IIndicesSink` と LIFO スタックで暗黙に受け渡す
- checkpoint: グラフ自体を `ModelGraphArchive`(format v2)で保存し、`modelGraphFingerprint` で再開時に一致を確認する。重みは `parameters()` の順番(= 層の並び順)で保存する

### 線形リストで表せないもの

「1つの層の出力が2か所以上で使われる」「2つ以上の入力を取る層がある」構造は表せない。

| 構造 | 例 |
|---|---|
| 分岐して離れた場所で合流(concat) | U-Net の skip connection |
| 残差(add) | ResNet、多くのバックボーン |
| 複数解像度の特徴を混ぜる | FPN(物体検出のネック) |
| 出力が複数 | 検出ヘッド(分類 + 回帰)、補助損失 |

SegNet の indices は、encoder と decoder が対称という前提の LIFO スタックで回避できた。しかし、これは「並び順に意味がある暗黙のルール」で、上の構造には一般化できない。

### 今決める理由

1. **ブロックプログラミングの GUI は、そもそも DAG を編集する UI。** ノードを自由に配線できる以上、線形リストでは GUI で作れるものの一部しか受け取れない
2. **研究対象が物体検出。** バックボーン + FPN + ヘッドは分岐と合流を前提にしている
3. **変更するなら今が一番安い。** Rust 側はまだ `training.proto` を使っておらず(`Capabilities` だけ)、フロントエンドはまだない。proto を変えても影響は C++ だけで済む。Rust クライアントと GUI を作った後だと、3か所の書き直しになる

### 以前の方針との関係

`model-config-and-training-rpc.md` では次のように決めていた。

- トポロジー: 「分岐と合流が必要になるまでは線形リストのまま」→ 上の理由で、**必要になった**と判断する
- params の持ち方: 「汎用 `Node{id, type, params: map<string, Value>}` を採用」→ 実際の proto は型付きの `oneof` で実装され、`start-training-request-contract.md` の契約(範囲チェック、`INVALID_ARGUMENT`)もそれを前提にしている。**この ADR では型付きの `oneof` を正式に採用し、汎用 `map` 案は取り下げる**(理由は「選択肢 2」)

この ADR が採用されたら、`model-config-and-training-rpc.md` の該当節はこの ADR で置き換える。

## 決定

1. **トポロジー: DAG にする。** 各ノードが「自分の入力ポートに、どのノードのどの出力ポートをつなぐか」を持つ(入力参照方式。ONNX、ComfyUI と同じ形)
2. **params: 今の型付き `oneof` をそのまま使う。** ノードは `LayerConfig` を1つ持つ
3. **pooling indices も普通のエッジにする。** `IndexedPooling` の出力ポート `indices` を `Unpooling` の入力ポート `indices` につなぐ。LIFO スタックと `IIndicesSource` / `IIndicesSink` は廃止する
4. **C++ の実行は「トポロジカル順に回すインタプリタ」にする。** 値は `(ノード ID, ポート名) → Tensor` の表で受け渡す
5. **GUI だけの情報(ノードの座標、グループ化など)は C++ に送らない。** フロント / Rust 側で保存する

### proto の形(案)

```proto
// 入力ポート 1 つ分の接続。source_node が空なら、グラフの入力(画像)を指す。
message PortRef {
    string node_id = 1;  // 参照先のノード。空 = グラフ入力
    string port = 2;     // 参照先の出力ポート名。例: "y", "indices"
}

message NodeInput {
    string port = 1;     // このノードの入力ポート名。例: "x", "indices"
    PortRef source = 2;
}

message Node {
    string id = 1;                    // グラフ内で一意。英数字・'-'・'_'
    LayerConfig layer = 2;            // 層の種類と params(既存の oneof をそのまま使う)
    repeated NodeInput inputs = 3;    // 可変長ポート(Concat の "x" など)は同じ port 名を順番に並べる
}

message ModelGraph {
    repeated Node nodes = 1;
    repeated PortRef outputs = 2;     // モデルの出力。当面は 1 つだけ受け付ける
}
```

エッジを `Edge{from, to}` の別リストにせず、ノードの中に入力参照として持つ理由:

- 「入力ポート1つにつき接続はちょうど1本」が構造で保証される(エッジのリストだと、同じ入力ポートへの2本目を別途検査する必要がある)
- 1つの出力を複数の場所で使う(分岐)は、複数のノードが同じ `PortRef` を参照するだけで表せる
- GUI の React Flow の `edges[{source, sourceHandle, target, targetHandle}]` からの変換は、target ごとにまとめるだけで済む

### ポートの定義(初期)

| 層 | 入力ポート | 出力ポート |
|---|---|---|
| Conv2D / BatchNorm / Activation / Pooling / Linear | `x` | `y` |
| IndexedPooling | `x` | `y`, `indices` |
| Unpooling | `x`, `indices` | `y` |
| Concat(新規) | `x`(可変長、順番に意味あり) | `y` |
| Add(新規) | `x`(可変長、2 個以上) | `y` |
| Upsample(新規) | `x` | `y` |

ポートの定義は C++ の entities に「ノード型カタログ」として1か所にまとめる。検証と実行の両方がこれを参照する。将来は Capabilities RPC で GUI に返し、GUI の部品一覧とポートの描画に使う(GUI と C++ で層の定義が二重管理にならないように)。

## 選択肢

### 選択肢 1: トポロジー

#### 1-A. 線形リストのまま(今のまま)

| 観点 | 評価 |
|---|---|
| 実装コスト | なし |
| 表現力 | 低い。SegNet 系まで。U-Net、ResNet、FPN、複数出力は表せない |
| GUI との相性 | 悪い。自由に配線できる UI と、受け取れるものが合わない |
| 検証 | 簡単(隣どうしのチャンネル数を見るだけ) |

良い点: 何もしなくてよい。checkpoint 形式も変わらない。
悪い点: 研究対象(物体検出)の標準的な構成が作れない。indices の LIFO のような暗黙のルールが増えていく。

#### 1-B. 線形リスト + 名前付きの退避と参照

層に `save_as: "skip1"` を付けて出力を退避し、`Concat{with: "skip1"}` で参照する方式。

| 観点 | 評価 |
|---|---|
| 実装コスト | 小〜中 |
| 表現力 | 中。concat / add はできる。複数出力や、途中で分岐して別の列になる構造は不自然 |
| GUI との相性 | 中。GUI の DAG をいったん直列に並べ直す変換が必要 |
| 検証 | 中。名前の解決と、参照する時点で退避済みかの確認が必要 |

良い点: 今の proto と実行器の延長で済む。
悪い点: 実質的に DAG を、並び順という暗黙のルール付きで表しているだけ。GUI → 直列化の変換が、新たな複雑さの置き場所になる。

#### 1-C. DAG(ノード + 入力参照)← 推奨

| 観点 | 評価 |
|---|---|
| 実装コスト | 中(下の「移行手順」1〜5) |
| 表現力 | 高い。分岐・合流・複数出力を同じ仕組みで表せる |
| GUI との相性 | 良い。ノードエディタのデータ構造とほぼ1対1 |
| 検証 | 中。閉路検出、未接続ポート、形状推論が必要(どの道 GUI のために必要) |

良い点: GUI・proto・C++ の表現が揃う。indices の暗黙のルールがなくなる。新しい合流系の層が「ポートを定義するだけ」で追加できる。
悪い点: checkpoint 形式が変わり、既存の checkpoint は読めなくなる。実行器と検証を書き直す。

### 選択肢 2: params の持ち方

#### 2-A. 型付き `oneof`(今のまま)← 推奨

- proto から Rust(prost)と C++ に型が生成され、範囲チェックの契約(`start-training-request-contract.md`)をそのまま使える
- 層を追加するたびに proto の変更が必要。ただし、C++ の層の実装とドメイン型の追加もどの道必要なので、proto だけが重荷になるわけではない

#### 2-B. 汎用 `map<string, Value>`

- 層の追加で proto を変えなくてよい
- 型の検査がすべて実行時になる。Rust で「必ず埋める項目」を保証する仕組み(既定値の埋め込み)を、層ごとに文字列キーで書き直すことになる
- 今の `TrainingProtoMapper` の検証と、`start-training-request-contract.md` の契約を作り直す必要がある

層を追加する頻度は、研究の進め方からみて「数週間に1つ」程度と見込む。毎回 proto を変えるコストより、型の安全性のほうが価値が大きいと判断する。

## トレードオフのまとめ

| | 1-A 線形 | 1-B 退避と参照 | 1-C DAG |
|---|---|---|---|
| 今の作業量 | 0 | 小〜中 | 中 |
| 物体検出(FPN / 複数ヘッド) | 不可 | 不自然 | 可 |
| GUI との対応 | 合わない | 変換が必要 | ほぼ 1 対 1 |
| 暗黙のルール | indices の LIFO | 並び順 + 名前 | なし |
| 後から変えるコスト | 大(Rust・GUI 実装後) | 中 | — |

1-B は今の作業量が少なく見えるが、GUI からの変換と並び順のルールを抱え込むことになり、最終的には 1-C への移行が必要になる可能性が高い。どうせ必要になるなら、Rust と GUI が `training.proto` に依存する前に 1-C へ移るのが一番安い。

## 実行時の設計(C++)

### entities(libtorch に依存しない)

- `ModelGraph { std::vector<GraphNode> nodes; std::vector<PortRef> outputs; }`
- `GraphNode { std::string id; LayersConfig layer; std::vector<NodeInput> inputs; }`
- ノード型カタログ: `LayersParams` の各型 → 入力ポート・出力ポートの定義
- `validateGraph(graph, inputChannels, numClasses)`: 次を確認する
  - ID の重複がない、参照先のノードとポートが存在する
  - 必須の入力ポートがすべて接続されている
  - 閉路がない(トポロジカルソートできる)
  - 形状推論: チャンネル数のつながり、Concat の合計チャンネル数、Add の形状一致、最終出力のチャンネル数 = クラス数
  - 入力サイズが、ダウンサンプリングの累積倍率で割り切れる
- `topologicalOrder(graph)`: 同順位のノードは `nodes` の並び順で決める(結果を決定的にするため)
- `linearToGraph(std::vector<LayersConfig>)`: 線形リストを DAG に変換する。各ノードの `x` は直前のノードの `y`。IndexedPooling / Unpooling の対応は、変換時に LIFO で解決して明示的なエッジにする。CLI のプリセット(`buildSegNetGraph` など)とテストで使う

### infrastructure(`TorchModel`)

- `ILayer::forward` を「入力ポートの Tensor 群 → 出力ポートの Tensor 群」に変える(単一入力の層は薄いラッパーで今の実装を流用)
- 構築時に `topologicalOrder` を1回計算して保持する
- `forward`: トポロジカル順に回し、`(ノード ID, ポート) → Tensor` の表で受け渡す。各値の最後の使用者を事前に数えておき、使い終わったら表から消す(学習時のメモリは autograd が保持する分が中心なので効果は限定的だが、推論時には効く)
- `parameters()` の順番は `nodes` の並び順(トポロジカル順ではない)。checkpoint の重みの対応がこの順番に依存するため
- `IIndicesSource` / `IIndicesSink` と LIFO スタックは削除する

### checkpoint

- `ModelGraphArchive` を format v3 にし、ノード ID と入力参照も保存する
- `modelGraphFingerprint` は `v2;` から始まる新しい形式にする
- **旧形式(v2、線形リスト)の checkpoint は読まない(2026-10-01 決定)。** 読もうとしたら「未対応の古いフォーマット」の例外にする(今の `readModelGraph` の方針どおり)。既存の `.pt` は、この変更より前のビルドでのみ使える

## 影響

### 簡単になること

- U-Net、ResNet、FPN、検出ヘッドなど、標準的な構成がそのまま書ける
- GUI ↔ Rust ↔ C++ でグラフの形が揃い、変換で情報が落ちない
- 合流系の層の追加が「ポートの定義 + 実装」だけで済む
- indices の対応が明示されるので、間違った組み合わせを実行前に検出できる

### 難しくなること

- 検証(閉路、形状推論)を書く必要がある。GUI で接続時にエラーを出すにも、この検証が必要
- 既存の checkpoint(v2)が読めなくなる。`output_dir` に古い `<model_name>_last.pt` が残っていると自動再開で失敗するので、移行後は退避するか `model_name` を変える
- CLI のプリセットを手で書くと、ノード ID の管理が面倒になる → `linearToGraph` と、分岐を書くための小さなビルダーで吸収する

### 後で決めること

- **複数出力と Loss の対応。** 検出ヘッドのように出力が2つ以上あるとき、どの出力にどの Loss をかけるか(`outputs` に名前を付け、Loss 側で参照する案)。当面は出力1つに限定する
- **可変長ポートの指定方法。** 同じポート名を並べる方式で足りるか、`x0`, `x1` のように番号を付けるか
- **グループ(サブグラフ)。** GUI で「encoder ブロック」のようなまとまりを再利用したい場合、GUI / Rust 側で展開してから送る(C++ は常にフラットな DAG を受け取る)方針を推奨。C++ でサブグラフを持つかは必要になってから決める
- **重み共有。** 同じ層を2か所で使う(重みを共有する)のは当面サポートしない。必要になったら `shared_with: node_id` のような参照で表す
- **ノード型カタログを Capabilities で返す形式。** GUI の実装を始めるときに決める

## 実装計画

> **進捗と残りのタスクは `model-graph-dag-tasks.md` にまとめている。** 以下は当初の計画で、ファイルの置き場所などが実際の構成と違う箇所がある(違いは `model-graph-dag-tasks.md` の「ADR から変わった点」)。

ブランチ `feat/DAG-struct` で、下の順に進める。

> **順番の変更(2026-10-01)**: proto の DAG 化とファイル分割(`model_graph.proto`、パッケージ `model.v1`)を先に行った。そのため、4 のうち proto の定義は完了済みで、**2 が終わるまで ai-engine はビルドできない**。0(変更前の出力の記録)は、proto を変更する前のコミット(main)でテストを書いて値を取る。mapper は 2 の中で、proto の `Node` をドメインの `GraphNode` に直接詰め替える形で書く(`linearToGraph` を経由する一時的な形は不要になった)。
>
> 当初の方針「各コミットの時点でビルドと全テストが通る」は、2 の完了以降に適用する。

C++ 側(1〜6)で ADR の範囲は完了する。Rust・フロントエンド・Capabilities(7〜9)は別の issue に分ける。

### 進め方の全体像

| # | 内容 | proto | checkpoint 形式 | 動作の変化 |
|---|---|---|---|---|
| 0 | 変更前の出力を記録するテスト | — | — | なし |
| 1 | entities に DAG の型と関数を追加(まだ使わない) | — | — | なし |
| 2 | `ModelGraph` を DAG に置き換え、`TorchModel` をインタプリタにする | 線形のまま(mapper で変換) | v3 | なし(0 のテストで確認) |
| 3 | 形状推論による検証 | — | — | 不正なグラフが学習前に止まる |
| 4 | proto を DAG にする | DAG | — | gRPC で DAG を受け付ける |
| 5 | Concat / Add / Upsample と U-Net のプリセット | 層を追加 | v3 のまま(LayerKind 追加) | 分岐・合流が使える |
| 6 | ドキュメントの整理 | — | — | — |

### 0. 変更前の出力を記録するテスト(characterization test)

リファクタの前後で計算結果が変わらないことを確かめるための基準を、**変更前のコード**で作る。

- 追加: `tests/model_graph_golden_test.cpp`
  - 小さい SegNet 型のグラフ(IndexedPooling / Unpooling を 2 組、チャンネル数は 4〜8 程度、入力 1×3×16×16)を CPU・固定 seed で組み立てる
  - 確認する値: `forward` の出力の合計値と先頭数要素、`trainStep` を 3 回回したときの loss
  - 期待値は、このコミットで実行して得た値をテストに直書きする(許容誤差 1e-6)
- 重みの初期化はノード(層)の生成順で決まる。後のコミットでもノードの並び順 = 生成順を守れば、同じ seed で同じ重みになる

**完了条件**: 現行コードでテストが通る。

### 1. entities に DAG の型と関数を追加する

既存の `ModelGraph` にはまだ触らない。新しい型は一時的に `DagModelGraph` という名前で追加し、2 で `ModelGraph` に置き換える。

追加するファイル(すべて `src/training/entities/`、libtorch に依存しない):

| ファイル | 内容 |
|---|---|
| `domain-objects/GraphNode.hpp` | `PortRef{nodeId, port}`(`nodeId` が空 = グラフ入力)、`NodeInput{port, source}`、`GraphNode{id, layer, inputs}` |
| `domain-objects/LayerPorts.hpp` | ノード型カタログ。`LayersParams` の各型 → 入力ポート(名前・必須・可変長)と出力ポートの一覧。`LayersParamsFields.hpp` と同じく「層を足したらここを直す」唯一の場所にする |
| `graph/GraphTopology.{hpp,cpp}` | `topologicalOrder(graph)`(Kahn 法。同順位は `nodes` の並び順)、閉路を見つけたら例外 |
| `graph/GraphStructureValidator.{hpp,cpp}` | 構造の検証: ID の重複と文字種、参照先のノードとポートの存在、未知のポート名、必須ポートの未接続、1 つの入力ポートへの重複接続、`outputs` が 1 つであること、閉路。エラーは「どのノードのどのポートか」をメッセージに含める |
| `graph/LinearGraphConverter.{hpp,cpp}` | `linearToGraph(std::vector<LayersConfig>)`。ID は `n0, n1, ...`。各ノードの `x` = 直前のノードの `y`。IndexedPooling / Unpooling の対応は、ここで LIFO を使って解決し、`indices` のエッジにする(対応しない場合は例外) |
| `graph/SequentialGraphBuilder.{hpp,cpp}` | プリセットやテストで使う、層を順に足していくためのビルダー。`add(layer)` は直前の出力に自動でつなぐ。分岐用に `add(layer, inputs)` と、直前のノード ID を返す `last()` を持つ |

テスト: `tests/model_graph_test.cpp`(トポロジカル順の決定性、閉路・未接続・重複接続の検出、`linearToGraph` で SegNet の indices のエッジが正しく張られること)

**完了条件**: 新しいテストが通る。既存のコードとテストは無変更。

### 2. `ModelGraph` を DAG に置き換え、`TorchModel` をインタプリタにする

このブランチで一番大きいコミット。動作が変わらないことを 0 のテストで確認する。

**entities**
- `ModelGraph` の中身を `DagModelGraph` の内容(`nodes`、`outputs`)に置き換え、`DagModelGraph` は削除する
- `modelGraphFingerprint` を新しい形式(`v2;`)にする。ノード ID、層、入力の接続、`outputs` を正規化文字列に含める。旧形式の `v1;` の計算は削除する

**adapters**
- `ILayer::forward` を `std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs)` にする。入力・出力の並びは `LayerPorts.hpp` のポート順(可変長ポートは接続した順に展開)
- `IIndicesSource` / `IIndicesSink` を削除する

**infrastructure**
- 既存の 7 つの `Torch*Layer` を新しい `forward` に合わせる。`TorchIndexPoolingLayer` は `{y, indices}` を返し、`TorchUnpoolingLayer` は `{x, indices}` を受け取る(`_lastIndices`、`provideIndices` は削除)
- `TorchModel`
  - 構築時に `validateGraphStructure` と `topologicalOrder` を実行し、順番と「各値を最後に使うノード」を保持する
  - 層は `nodes` の並び順で生成する(重みの初期化と `parameters()` の順番を変えないため)
  - `forward`: トポロジカル順に回し、`(ノード ID, ポート) → Tensor` の表で受け渡す。最後の使用が済んだ値は表から消す
  - LIFO スタックと `_useIndices` を削除する
- `ModelGraphArchive` を format v3 にする。保存するもの: ノード数、各ノードの ID・層(今の `writeLayer` を流用)・入力の接続、`outputs`。v2 以前を読もうとしたら「未対応の古いフォーマット」の例外にする

**呼び出し側**
- `TrainingApp.cpp`: `appendEncoderBlock` などを `SequentialGraphBuilder` を使う形に書き換える。indices の接続は、encoder で `IndexedPooling` のノード ID を記録しておき、decoder の `Unpooling` に明示的につなぐ
- `TrainingJob.cpp`: `layers.empty()` を `nodes.empty()` にする
- `TrainingProtoMapper.cpp`: proto はまだ線形なので、`toLayer` で変換した層のリストを `linearToGraph` で DAG にする(4 で置き換える一時的な形)

**テスト**: `model_graph_archive_test`、`checkpoint_rebuild_test`、`checkpoint_roundtrip_test`、`device_parity_test`、`training_proto_mapper_test`、`training_smoke_test` のグラフ組み立てを `SequentialGraphBuilder` か `linearToGraph` に置き換える

**完了条件**
- 全テストが通る。特に `model_graph_golden_test` の値が 0 で記録した値と一致する
- CLI で SegNet を 1 エポック学習でき、checkpoint の保存と再開ができる

### 3. 形状推論による検証

GUI で自由に組んだグラフの間違いを、学習を始める前に見つける。

- 追加: `src/training/entities/graph/GraphShapeInference.{hpp,cpp}`
  - 入力 `(C, H, W)`(C は 3、H と W は `dataSpec` の入力サイズ)から、トポロジカル順に各出力ポートの形状を計算する
  - 層ごとの規則: Conv2D / Pooling は PyTorch の出力サイズの式(dilation を含む)、Unpooling は `(H-1)*stride - 2*padding + kernel`、BatchNorm は `num_features == C`、Linear は最後の次元 `== in_features`
  - 確認すること: 前の層の出力チャンネル数 = Conv2D の `in_channels`、Unpooling の `x` と `indices` の形状が一致、出力サイズが 1 以上、最終出力のチャンネル数 = クラス数
- 呼び出す場所: `runTrainingJob` の、labelmap を読んでクラス数が決まった直後(モデルを組み立てる前)
- 失敗したときのメッセージには、ノード ID・ポート・期待した形状と実際の形状を入れる
- 副産物として、各ノードの出力形状がわかるので、`docs/重みと計算量の見積もり.md` の計算(活性化のメモリ)を自動化できる。今回はやらないが、batch_size を決める助けになる(先日の OOM の対策)

テスト: `tests/graph_shape_inference_test.cpp`(SegNet / SegNetDilated / SegNetFullDilated が 256×256 で通る、チャンネル数の不一致、Unpooling の形状の不一致、クラス数の不一致)

**完了条件**: CLI のプリセットがすべて検証を通る。わざと壊したグラフが、学習前にわかりやすいメッセージで止まる。

### 4. proto を DAG にする

- `training.proto`: ADR の「proto の形」のとおり、`PortRef` / `NodeInput` / `Node` を追加し、`ModelGraph` を `nodes` と `outputs` にする。`repeated LayerConfig layers = 1` は削除して番号 1 を `reserved` にする(Rust とフロントはまだ使っていないので、互換は不要)
- 契約をコメントに書く: ノード ID の文字種、`outputs` は当面 1 つ、`source.node_id` が空ならグラフ入力
- `TrainingProtoMapper`: `toModelGraph` を書き直す。`toLayer` はそのまま使い、エラー位置の表記を `model_graph.nodes[3](id=enc2_pool).inputs[1]` のようにする。最後に `validateGraphStructure` を呼び、失敗は `INVALID_ARGUMENT` にする
- テスト: `training_proto_mapper_test` に、正常な DAG、未接続ポート、閉路、存在しない参照先のケースを足す
- 手動確認: grpcurl で SegNet 相当の DAG(JSON)を送り、学習が完了まで進むこと。送った JSON は `configs/segnet_dag.json` としてリポジトリに置く(Rust と GUI を作るときの見本になる)

**完了条件**: grpcurl から DAG で学習できる。

### 5. Concat / Add / Upsample と U-Net のプリセット

分岐と合流が実際に動くことを確認する。層の追加手順は `add-ml-component` スキルに従う。

| 層 | params | ポート | 形状の規則 |
|---|---|---|---|
| Concat | なし(チャンネル方向で固定) | `x`(可変長、2 個以上)→ `y` | H と W が一致、C は合計 |
| Add | なし | `x`(可変長、2 個以上)→ `y` | 形状がすべて一致 |
| Upsample | `scale_factor`(整数)、`mode`(nearest / bilinear) | `x` → `y` | H と W を `scale_factor` 倍 |

- 各層ごとに: entities の `*Params`、`LayerKind`(末尾に 7, 8, 9 を追加)、`LayersParamsFields`、`LayerPorts`、形状の規則、`Torch*Layer`、`TorchLayerBuilder`、proto の `LayerConfig`、mapper、テスト
- `ModelGraphArchive` の `static_assert` の要素数を更新する。format は v3 のまま(層の種類が増えるだけで、レイアウトは変わらないため)
- `ModelArchitectureType` に `Unet` を追加する(`.config` の `model_architecture` で選べる)。encoder 3 段 + decoder 3 段で、concat の skip connection を使う小さい構成
- 確認: CPU で U-Net を 1 エポック学習し、checkpoint の保存と再開ができること。GPU サーバーでも 1 回動かす

**完了条件**: U-Net が CLI と grpcurl の両方で学習できる。

### 6. ドキュメントの整理

- `model-config-and-training-rpc.md`: 「config スキーマの表現方針」の節を、この ADR への参照に置き換える
- `start-training-request-contract.md`: 「層のつながり」「Pooling / Unpooling の対応」「入力サイズ」の確認項目を、3 の形状推論で完了済みにする。Rust 側の構造チェックの項目を追加する
- `.config` の `model_architecture` のコメントを、残したプリセット(`SegNet` / `Unet`)に合わせる(`Sample` / `SegNetDilated` / `SegNetFullDilated` は削除した)
- `開発ロードマップ.md` の「model config のグラフ表現」を更新する

### 7〜9. このブランチの後(別の issue)

7. **Rust**: `training.proto` のクライアント、既定値の埋め込み、送信前の構造チェック(ID の重複、未接続ポート、閉路)。`configs/segnet_dag.json` を読み込んで送れるようにする
8. **フロントエンド**: React Flow のノードエディタ → proto の `ModelGraph` への変換。ノードの座標などは別に保存する。プリセット(SegNet、U-Net)をテンプレートとして読み込めるようにする
9. **Capabilities**: `LayerPorts` と各層の params の定義を返す RPC を追加し、GUI の部品一覧と設定フォームをそこから作る

### この計画で既定にした判断(変えたい場合は着手前に)

| 判断 | 既定 | 理由 |
|---|---|---|
| 旧形式の checkpoint の読み込み | **対応しない**(2026-10-01 決定) | 既存の `.pt` は移行前のビルドでのみ使う |
| Concat の結合方向 | チャンネル方向で固定(params なし) | セグメンテーションと検出の用途ではチャンネル方向しか使わない。必要になったら `dim` を足す |
| モデルの出力 | 1 つだけ(2026-10-01 確認) | 複数出力と Loss の対応は、検出ヘッドを作るときに別の ADR で決める |
| グラフの入力 | 1 つ(画像)(2026-10-01 確認) | `PortRef.node_id` が空 = 画像。複数入力が必要になったら名前付きにする |
| ノード ID の文字種 | 英数字・`-`・`_` | `model_name` と同じ規則。エラーメッセージと checkpoint のキーに使うため |

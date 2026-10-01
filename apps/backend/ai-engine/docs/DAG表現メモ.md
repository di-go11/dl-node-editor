# DAG

DAG(Directed Acycllic Graph)=有効非巡回グラフ
ここでは、ブロックプログラミングを可能とするためにDAGをどのようにして、プログラムで表現されているのかについてまとめる。

## ノードエディタやブロックプログラミングに使われる4つの部品

1. ノード型の定義(スキーマ)
「Conv2Dというブロックには入力ポートが1つ、出力ポートが1つ、パラメータはin/out channels, kernnel...」という型のカタログを決める必要がある。GUIはこれを見てブロックのパレットや設定フォームを作り、記録できるポートを決める。

```schema
Conv2D:        inputs [x]            outputs [y]            params {in_ch, out_ch, kernel, ...}
MaxPoolIdx:    inputs [x]            outputs [y, indices]   params {kernel, stride}
Unpool:        inputs [x, indices]   outputs [y]            params {kernel, stride}
Concat:        inputs [a, b]         outputs [y]            params {dim}
```

2. グラフのインスタンス(ノード+エッジ)

ユーザが組んだものは、ほぼどのツールでも次の形で保存される。

実例もこんな感じ.

- React Flow（React のノードエディタ）: `nodes[]` と `edges[{source, sourceHandle, target, targetHandle}]`
- ComfyUI: 各ノードの入力に「[参照先ノードID, 出力番号]」を書く（エッジをノード側に埋め込んだ形）
- ONNX: 各ノードが入力と出力の「値の名前」を持ち、同じ名前どうしがつながる（エッジは暗黙）
- Keras の Functional API の get_config(): 各層が inbound_nodes を持つ

ポート単位でつなぐのがポイント。上の例では、SegNet の `pooling indices` が `n2.indices → n3.indices` という明示的なエッジになる。これにより、U-NetのskipやResNetのaddも同じ感じで表せる。

3. 検証(型・形状の推論)

トポロジカルソートで順番を決めながら、次のことを確認する。

- 閉路がないか
- 必須の入力ポートがすべてつながっているか
- 形状(チャンネル数や解像度)があっているか

GUIで接続した瞬間にエラーが出る場合赤くするのもこれ。

4. 実行器

```c++
// 型名 → モジュール生成関数(レジストリ)
registry["Conv2D"]     = [](const Params& p) { return std::make_shared<ConvNode>(p); };
registry["MaxPoolIdx"] = ...;

// 構築: ノードごとに生成して register_module(パラメータを optimizer に渡すため)
for (auto& n : graph.nodes) modules[n.id] = register_module(n.id, registry.at(n.type)(n.params));

// forward: トポロジカル順に実行し、(ノードID, ポート名) → Tensor の表で値を受け渡す
std::map<PortRef, Tensor> values{{inputPort, x}};
for (auto& id : topoOrder) {
    auto ins  = gatherInputs(id, edges, values);  // 入力ポートにつながる値を集める
    auto outs = modules[id]->forward(ins);        // 出力ポート名 → Tensor
    for (auto& [port, t] : outs) values[{id, port}] = t;
}
return values.at(outputPort);
```
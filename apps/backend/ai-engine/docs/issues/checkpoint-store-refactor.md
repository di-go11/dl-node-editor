# refactor: チェックポイント保存を ICheckpointStore に切り出す

## 背景 / 問題

`TrainModelUsecase`（application 層）が、ベストモデル保存機能の実装時に
`IModel` と `IModelStore` を直接 DI するようになっている。さらに Optimizer 状態の
保存を組み込むには `IOptimizer` の注入も必要になる。

しかし依存方向は `entities → application → adapters → infrastructure` であり、
`IModel` / `IOptimizer` は **adapters/interfaces** に属する（かつシグネチャに
`at::Tensor` が出てくる libtorch 寄りの抽象）。application からこれらに依存するのは
依存方向が逆で、`clean-arch-lint` に引っかかる。

現状の `TrainModelUsecase` の依存:

| 依存 | 層 | 可否 |
|---|---|---|
| `IModelTrainer` / `IModelEvaluator` | application/interfaces | OK |
| `IModelStore` | application/interfaces | 概ね OK（引数に `IModel` が出る点は要検討） |
| `IModel` | adapters/interfaces | NG（逆方向） |
| `IOptimizer`（追加予定） | adapters/interfaces | NG（逆方向） |

## 方針

Usecase の責務は「**いつ**チェックポイントを取るか」に限定し、
「**何を**シリアライズするか」は application/interfaces のポート越しに下位へ隠す。

### 新規: `application/interfaces/ICheckpointStore.hpp`

```cpp
class ICheckpointStore
{
public:
    virtual ~ICheckpointStore() = default;
    // ベストが更新されたとき呼ばれる。モデル重み + optimizer 状態 + epoch を保存。
    virtual void saveBest(unsigned int epoch) = 0;
};
```

### 新規: `infrastructure/torchModel/TorchCheckpointStore.{hpp,cpp}`

- `std::shared_ptr<IModel>` / `std::shared_ptr<IOptimizer>` と出力先（dir, modelName）を保持
- `saveBest()` で以下を書き出す:
  - モデル重み（既存の `IModelStore::save` 相当、または `TorchModel` を直接）
  - `IOptimizer::saveState(...)`（← 別 issue で追加済み）
  - epoch などのメタ情報
- ファイル構成は「重み + optimizer + meta」の複数ファイルで可（単一ファイル化は任意）

### `TrainModelUsecase` の変更

- DI から `IModel` / `IModelStore` を除去し、`ICheckpointStore` に置き換え
- コンストラクタ引数は `trainer / evaluator / checkpointStore`（+ param, appConfig）
- `execute()`:
  ```cpp
  if (bestMiou.update(valMetrics.meanIoU))
      _checkpointStore->saveBest(epoch);
  ```
- `checkpointPath()` ヘルパは `TorchCheckpointStore` 側へ移動

### main.cpp

- `TorchCheckpointStore` を組み立てて Usecase に渡す

## タスク

- [x] `ICheckpointStore`（application/interfaces）
- [x] `TorchCheckpointStore`（infrastructure）: 重み + optimizer 状態 + epoch を 1 archive に
- [x] `TrainModelUsecase` の DI を `ICheckpointStore` に置換、`IModel`/`IModelStore` 依存を除去
- [x] main.cpp の配線
- [x] `best_checkpoint_test` を `FakeCheckpointStore`（`saveBest` の呼び出し回数・epoch を記録）に更新
- [ ] save→load で optimizer の `exp_avg` 等が復元されることのテスト
- [x] `clean-arch-lint` で application→adapters 依存が消えたことを確認

## 残課題

- `TorchCheckpointStore::saveBest` の書き出しはあるが、チェックポイントからの **読み戻し (resume)** 経路は未実装
- 旧 `IModelStore` / `TorchModelStore` は `ICheckpointStore` に置き換わり削除済み。
  推論時の重みのみロードが必要になったら、`IModel::readFrom` を使う軽量パスを別途用意する
- `TorchCheckpointArchive.hpp` が `infrastructure/torchModel/` に置かれているが `torchFunc/` の Optimizer からも参照している。より中立な infra 位置への移動を検討

## 関連

- optimizer-state-save.md — `IOptimizer::saveState/loadState` は追加済み
- ベストモデル保存機能（コミット d53256c 前後）の後始末

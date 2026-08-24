---
name: add-ml-component
description: Optimizer / Loss / Activation など、libtorchをラップする新しい学習コンポーネントを、既存のクリーンアーキテクチャ4層構造(entities → application → adapters → infrastructure)に沿って追加する。「新しいOptimizerを追加して」「Lossを実装して」のような依頼で使う。
---

# add-ml-component

`src/training/` 配下は Clean Architecture の4層構造になっている。新しい Optimizer / Loss / Activation (または類似の torchFunc コンポーネント) を追加するときは、この構造と既存の命名規則を壊さないことが最優先。

## 層の役割と依存方向

```
entities (domain-objects, interface)   … 最内層。他の層に依存しない。libtorchの具象型を知らない。
   ↑
application (interfaces, impl)         … ユースケース。entitiesとadaptersのinterfaceにのみ依存。
   ↑
adapters (interfaces, impl)            … IOptimizer / ILoss / IActivation などの抽象境界。
   ↑
infrastructure (torchFunc, readConfig) … libtorchへの具象実装。ここでのみ <torch/torch.h> を直接includeしてよい。
```

依存は必ず外側→内側(infrastructure → adapters → application → entities)。内側の層が外側の層や `torch::` の具象型を直接知ってはならない。

## 追加手順

新しい Optimizer を例にすると:

1. **Config構造体を追加** (`entities/domain-objects/OptimizerConfig.hpp`)
   - 既存の `AdamOptimizerConfig` / `SGDOptimizerConfig` と同様に、`OptimizerConfig` を継承した構造体を追加する。
   - フィールドはプリミティブ型のみ(`double`, `bool`, `int` など)。libtorch型を持ち込まない。
   - 対応する種別が `OptimizerType.hpp` に無ければ追加する。

2. **既存interfaceを再利用する** (`adapters/interfaces/IOptimizer.hpp` など)
   - 通常は既存の `IOptimizer` / `ILoss` / `IActivation` をそのまま実装すればよい。
   - 既存インターフェースのメソッド群で表現できない全く新しい種類のコンポーネントを追加する場合のみ、新しいinterfaceを検討する。その場合は必ずユーザーに設計方針を相談する(CLAUDE.mdの方針: 大きな機能追加は事前相談)。
   - interfaceは純粋仮想関数のみで構成し、libtorchの型は前方宣言(`namespace torch { class Tensor; }` 等)を使い、`.hpp`内で`<torch/torch.h>`を直接includeしない。

3. **infrastructure層に実装クラスを追加** (`infrastructure/torchFunc/header/XxxOptimizer.hpp` + `src/XxxOptimizer.cpp`)
   - `AdamOptimizer` を手本にする:
     - ヘッダでは `torch::optim::XXX` 等を前方宣言し、`std::unique_ptr` でメンバに持つ(サイズ非依存にするため)。
     - `.cpp` 側でのみ `<torch/torch.h>` をincludeし、実際の生成・処理を書く。
     - コンストラクタはConfig構造体ではなく素のパラメータ(`double learningRate` 等)を受け取るスタイルが現状の慣習。
   - クラス名は `XxxOptimizer` / `XxxLoss` / `XxxActivation` のように種別を後置する既存の命名に合わせる。

4. **ConfigReaderへの文字列⇔enum対応を追加** (`infrastructure/readConfig/src/ConfigReader.cpp`)
   - 新しい `OptimizerType` / `ActivationType` の分岐を、既存の `if/else if` 連鎖に追加する。

5. **CMakeの確認**
   - `CMakeLists.txt` は `file(GLOB_RECURSE ALL_SRCS "src/training/*.cpp")` で自動収集しているため、新規ファイルの追加でCMakeLists自体の編集は基本不要。ビルド確認は `cpp-build` skill、または `cmake --build build` を使う。

## 注意点

- **Config→実装インスタンスを紐付けるファクトリは、現時点(2026-08時点)で未実装**。`ConfigReader` は文字列をenum(`OptimizerType`など)に変換するところまでで、`OptimizerConfig` から `AdamOptimizer` インスタンスを生成するファクトリ/switch文はまだ存在しない。もしこの接続部分の実装を求められたら、既存コードに前例が無い設計判断になるため、先にクラス構成・配置場所をユーザーに相談すること(CLAUDE.mdの「大きな機能実装は事前相談」の方針)。
- 新規ファイルの作成は、理由に関わらず事前にユーザーへ確認する(グローバルCLAUDE.mdの方針)。
- コメントは元のコードの慣習(日本語の一言コメントがところどころにある)に合わせてよいが、必要最小限に留める。
- 実装後は、なぜその設計(層の分割、依存方向)が妥当なのかを一言添えて説明する — このプロジェクトの学習目的(独学中の学生)に沿うため。

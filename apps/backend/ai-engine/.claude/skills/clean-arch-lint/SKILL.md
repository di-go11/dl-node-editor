---
name: clean-arch-lint
description: src/training配下の変更が、クリーンアーキテクチャの依存方向(entities→application→adapters→infrastructure)を破っていないかレビューする。「アーキテクチャ的に問題ないかチェックして」「レビューして」「コミット前に確認して」のような依頼で使う。
---

# clean-arch-lint

`src/training/` はClean Architectureの4層構造(entities / application / adapters / infrastructure)を前提にしている。このskillは、変更されたC++ファイルがこの依存方向を守っているかを機械的にチェックし、違反があれば具体的なファイル・行を指摘する。

## 層と許可される依存

| 層 | ディレクトリ | 依存してよいもの | 依存してはいけないもの |
|---|---|---|---|
| entities | `entities/domain-objects`, `entities/interface` | 標準ライブラリ、同じentities内の他ファイル | `<torch/torch.h>`、adapters/application/infrastructureの具象クラス |
| application | `application/interfaces`, `application/impl` | entities、application/interfaces | adapters/impl、infrastructureの具象クラス、`<torch/torch.h>` |
| adapters | `adapters/interfaces`, `adapters/impl` | entities、adapters/interfaces | infrastructureの具象クラス |
| infrastructure | `infrastructure/*` | entities、adapters/interfaces、libtorch | (最外層なので基本的に制約なし。ただしinfrastructure間の不要な相互依存は避ける) |

## チェック手順

1. 対象範囲を決める。デフォルトは `git diff` (未コミット差分) が対象の `src/training/**/*.hpp` `*.cpp`。ユーザーが対象を指定していればそれに従う。

2. 各ファイルについて、`#include` 文と実際に使っている型を確認する。

```bash
git diff --name-only -- 'src/training/**/*.hpp' 'src/training/**/*.cpp'
```

3. 以下の違反パターンを探す:

   - **a. entities/application層のヘッダで `<torch/torch.h>` や `<ATen/...>` を直接includeしている**
     → 前方宣言 (`namespace torch { class Tensor; }` 等) で足りるはずなので、includeを外し前方宣言に置き換えられないか確認する。既存の `IModel.hpp` / `ILoss.hpp` の前方宣言パターンを参照。

   - **b. adapters/interfaces の `.hpp` が具象クラス(infrastructure配下のクラスや `torch::optim::Adam` など)を直接参照している**
     → interfaceは抽象化境界なので、具象型への依存はここでは不可。

   - **c. application層(`application/impl`)が infrastructure配下のヘッダを直接includeしている**
     → application は adapters/application の interface にのみ依存すべき。infrastructureの実装クラスへの直接依存はDIコンテナ/ファクトリ経由にすべき違反。

   - **d. entities配下の構造体(Config系)がプリミティブ型以外(libtorchの型、STLコンテナ以外の外部型)を持っている**
     → Config構造体は値の入れ物であるべきで、フレームワーク型を持ち込むと外側の層への依存が発生する。

   - **e. 循環include・相互参照**
     → 稀だが、interfaceを跨いだ相互依存が無いか確認。

4. 違反が見つかったら、ファイルパス・行番号・該当コードを引用し、なぜ問題か(どの依存方向の原則に反するか)を説明する。修正案も添える。

5. 違反が無ければ、確認した層と観点を簡潔に報告する(過剰な報告は避ける)。

## 注意点

- このプロジェクトは学習目的(独学中の学生のクリーンアーキテクチャ実践)なので、指摘は「なぜダメか」を一言添えて説明する。単に「違反です」で終わらせない。
- 既存コードにも前方宣言を使わずに済ませている箇所があるかもしれない。新規/変更差分を優先してチェックし、無関係な既存コードの指摘で範囲を広げすぎない。
- このチェックはコンパイラやlinterの代替ではない。ビルド確認は別途 `cpp-build` 等で行う。

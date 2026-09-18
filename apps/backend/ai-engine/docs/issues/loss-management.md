# Loss管理機能の実装 — LossConfig を設定駆動で選べるようにする

## 背景

`Dice_loss` / `Focal_loss` / `Combo_loss` / `Boundary_loss`(いずれも`ILoss`実装、`infrastructure/torchFunc/`配下)とテスト(`tests/loss_function_test.cpp`)は実装済み。既存の`CrossEntropy`を含め5種類の損失関数が揃っている。

しかし現状、`TrainingApp.cpp`では`auto loss = std::make_shared<CrossEntropy>();`と決め打ちになっており、`.config`から損失関数を選ぶ手段がない。`OptimizerConfig` / `IOptimizerFactory` / `TorchOptimizerFactory`(Optimizerの選択機構)と全く同じパターンで、Loss側にも同様の設定駆動の仕組みを作る。

`LossConfig`(`entities/domain-objects/LossConfig.hpp`)は実装済み。`OptimizerConfig`と同じ`std::variant`方式で、`CrossEntropyConfig` / `MseLossConfig` / `DiceLossConfig` / `FocalLossConfig` / `ComboLossConfig` / `BoundaryLossConfig`を種別ごとに持つ。infrastructure側の同名`ILoss`実装クラスとグローバル名前空間で衝突しないよう、設定側は`*Config`サフィックスを付けている(`AdamOptimizer` / `AdamOptimizerConfig`と同じ命名規則)。

## やること

- [ ] `ILossFactory`(`adapters/interfaces/ILossFactory.hpp`)を追加する
  - `IOptimizerFactory`と同じ形: `virtual std::shared_ptr<ILoss> create(const LossConfig &config) = 0;`
- [ ] `TorchLossFactory`(`infrastructure/torchFunc/TorchLossFactory.hpp/.cpp`)を追加する
  - `TorchOptimizerFactory`と同じく`std::visit` + `Overloaded`で`LossConfig`の各alternativeを対応する`ILoss`実装に変換する
- [ ] `AppConfig`(`entities/domain-objects/AppConfig.hpp`)に`LossConfig loss`を追加する
- [ ] `ConfigReader.cpp`に`.config`からの`LossConfig`組み立てを追加する(`buildOptimizerConfig`と同じパターンで`buildLossConfig`を作る。`loss_type` / `num_classes` / `gamma` / `alpha` / `ignore_index`等のキーを追加)
- [ ] `TrainingApp.cpp`の決め打ち箇所(`auto loss = std::make_shared<CrossEntropy>();`)を`lossFactory->create(appConfig.loss)`に置き換える
- [ ] `CheckpointModelLoader`など、checkpointから再構築する経路がある場合はそちらにも同様の配線が必要か確認する(`TorchOptimizerFactory`がどう関わっているか参照)

## 未決定事項(着手前に方針を決める)

- **活性化(Softmax)との整合**: `CrossEntropy`は生ロジット入力(内部でsoftmax)を前提にしているのに対し、`Dice/Focal/Combo/Boundary`はsoftmax活性化済みの確率を入力とする前提(`LossType.hpp`のコメント参照)。現状のモデル末尾には活性化層が付いていない(`buildSampleModelGraph`のコメント「CrossEntropyが内部でsoftmaxするため末尾に活性化層は置かない」)。
  - `LossType`で`CrossEntropy`以外を選んだ場合、モデル末尾にSoftmax活性化を自動的に付与する仕組みが必要
  - 案A: `TrainingApp`側で`LossType`を見てモデル末尾にSoftmax層を条件付きで追加する
  - 案B: `ModelGraph`を組む側(GUI/config)で活性化層を明示的に選ばせ、`LossType`との整合性(組み合わせが不正でないか)は起動時にバリデーションだけ行う
  - この設計判断は本issue着手前に確定させる

## 影響範囲

- 新規: `adapters/interfaces/ILossFactory.hpp`
- 新規: `infrastructure/torchFunc/TorchLossFactory.hpp/.cpp`
- `entities/domain-objects/AppConfig.hpp`
- `infrastructure/readConfig/ConfigReader.cpp`
- `TrainingApp.cpp`
- (未決定事項次第で)モデルグラフ構築処理、`ModelGraph`関連

## 完了条件

- `.config`の`loss_type`を切り替えることで、`CrossEntropy` / `Dice_loss` / `Focal_loss` / `Combo_loss` / `Boundary_loss`のいずれでも学習ループが実データでエラーなく完走する
- 活性化(Softmax)との整合性の未決定事項が解消されている

## 備考

- `LossConfig.hpp`は実装・ビルド確認済み(このissue着手時点の前提)
- `Dice/Focal/Combo/Boundary`の数値的な妥当性は`tests/loss_function_test.cpp`(12ケース)でテスト済み

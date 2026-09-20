# Loss管理機能の実装 — LossConfig を設定駆動で選べるようにする

## 背景

`Dice_loss` / `Focal_loss` / `Combo_loss` / `Boundary_loss`(いずれも`ILoss`実装、`infrastructure/torchFunc/`配下)とテスト(`tests/loss_function_test.cpp`)は実装済み。既存の`CrossEntropy`を含め5種類の損失関数が揃っている。

しかし現状、`TrainingApp.cpp`では`auto loss = std::make_shared<CrossEntropy>();`と決め打ちになっており、`.config`から損失関数を選ぶ手段がない。`OptimizerConfig` / `IOptimizerFactory` / `TorchOptimizerFactory`(Optimizerの選択機構)と全く同じパターンで、Loss側にも同様の設定駆動の仕組みを作る。

`LossConfig`(`entities/domain-objects/LossConfig.hpp`)は実装済み。`OptimizerConfig`と同じ`std::variant`方式で、`CrossEntropyConfig` / `MseLossConfig` / `DiceLossConfig` / `FocalLossConfig` / `ComboLossConfig` / `BoundaryLossConfig`を種別ごとに持つ。infrastructure側の同名`ILoss`実装クラスとグローバル名前空間で衝突しないよう、設定側は`*Config`サフィックスを付けている(`AdamOptimizer` / `AdamOptimizerConfig`と同じ命名規則)。

## やること

- [x] `ILossFactory`(`adapters/interfaces/ILossFactory.hpp`)を追加する
  - 当初案は`create(const LossConfig &config)`だったが、実装では`create(config, int numClasses, int64_t ignoreIndex)`とした(下の「決定事項」参照)
- [x] `TorchLossFactory`(`infrastructure/torchFunc/TorchLossFactory.hpp/.cpp`)を追加する
  - `TorchOptimizerFactory`と同じく`std::visit` + `Overloaded`で`LossConfig`の各alternativeを対応する`ILoss`実装に変換する
- [x] `AppConfig`(`entities/domain-objects/AppConfig.hpp`)に`LossConfig loss`を追加する(あわせて`int64_t ignoreIndex`も追加)
- [x] `ConfigReader.cpp`に`.config`からの`LossConfig`組み立てを追加する(`loss_type` / `gamma` / `alpha` / `ignore_index`。`num_classes`は廃止、下の「決定事項」参照)
- [x] `TrainingApp.cpp`の決め打ち箇所を`lossFactory->create(appConfig.loss, numClasses, appConfig.ignoreIndex)`に置き換える
- [x] `CheckpointModelLoader`など、checkpointから再構築する経路がある場合はそちらにも同様の配線が必要か確認する
  - 確認結果: `CheckpointModelLoader`はLossを扱わない(Lossは学習状態を持たない)ため、配線は不要
- [ ] `.config`の`loss_type`を切り替えて、実データで学習ループが完走することを確認する(未実施。Softmax付与が前提になるため、GUI実装後、または手動でモデルグラフを変更して確認)

## 決定事項

- **活性化(Softmax)との整合**: GUIを作成する際、Softmaxを必要とする損失関数(`Dice/Focal/Combo/Boundary`)が選ばれた場合に、活性化層の選択を制御する(グレーアウト等)。案B(活性化層を明示的に選ばせる)の系統。
  - バックエンド側の起動時バリデーション(`LossType`と最終活性化層の整合確認)は未実装。`.config`の手書きやgRPC APIの直接呼び出しはGUIを経由しないため、GUI/API実装時にあわせて追加する(防御の多層化)。
  - 現状は、`CrossEntropy`以外を選んでもSoftmaxが自動付与されないため、生ロジットが確率として扱われ、エラーなく数値が誤ったまま学習が走る点に注意。
- **`ignoreIndex`の一元化**: 前処理(余白の埋め値)・Loss・評価で同じ値を使う必要があるため、`AppConfig::ignoreIndex`(`.config`の`ignore_index`、0〜255)を唯一の情報源とし、Loss側には`ILossFactory::create`の引数で渡す。`LossConfig`には持たせない。`MseLoss`は使わない。`CrossEntropy`も直書きの255をやめてこの値を使う。
- **`numClasses`の扱い**: `.config`の`num_classes`は廃止。`labelmap.txt`のエントリ数(モデル出力チャネル数・評価器と同じ値)を`ILossFactory::create`の引数で渡す。クラス数の不一致が構造上起こり得なくなる。古い`.config`に`num_classes`が残っていると"Unknown config key"で起動時にエラーとなる。
- **VOC以外のデータセットへの対応**: クラス数は現状`labelmap.txt`(Pascal VOC形式)に依存している。VOC以外に対応する場合は、`.config`ではなくデータ読み込み層(形式ごとのReader)がクラス数を提供する形で拡張する。現時点では未対応(YAGNI)。

## 未決定事項

- `create`の引数が増えた場合(現在は`numClasses`と`ignoreIndex`の2つ)、`int`と`int64_t`が並ぶため取り違えが型で検出されない。増える場合は`DatasetInfo`のような構造体にまとめることを検討する。
- `ignore_index`が実クラスIDと衝突していないかの検証は未実装。

## 影響範囲

- 新規: `adapters/interfaces/ILossFactory.hpp`
- 新規: `infrastructure/torchFunc/TorchLossFactory.hpp/.cpp`
- `entities/domain-objects/AppConfig.hpp`
- `infrastructure/readConfig/ConfigReader.cpp`
- `TrainingApp.cpp`
- (未決定事項次第で)モデルグラフ構築処理、`ModelGraph`関連

## 完了条件

- `.config`の`loss_type`を切り替えることで、`CrossEntropy` / `Dice_loss` / `Focal_loss` / `Combo_loss` / `Boundary_loss`のいずれでも学習ループが実データでエラーなく完走する
- 活性化(Softmax)との整合性の方針が決まっている(決定済み。実装はGUI/API側)

## 備考

- `LossConfig.hpp`は実装・ビルド確認済み(このissue着手時点の前提)
- `Dice/Focal/Combo/Boundary`の数値的な妥当性は`tests/loss_function_test.cpp`(12ケース)でテスト済み

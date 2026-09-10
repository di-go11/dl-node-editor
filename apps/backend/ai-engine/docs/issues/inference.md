# feat: 推論(inference)機能 — 学習済みモデルでその場で推論する

関連: `gpu-support.md`（Phase 1 完了）/ `grpc-layer.md`（Phase 2、gRPC 層）。
本 issue は gRPC 層が立った**後**に着手する。

## 背景

学習パイプライン（cold start / resume / checkpoint）は動くが、**学習済みモデルを
使って推論する経路が無い**。

CLAUDE.md の目的は「研究の試行錯誤の効率を上げる」。構造をいじる →
学習 → **結果を目で見る** のループが回らないと、指標の数字だけでは
モデルの良し悪しが分からない（`fix/evaluator-ignore-index` で val_mIoU が
横ばいだった件も、予測マスクを見れば早く気付けた）。

将来の「機械のセンサとしてのローカルアプリ」も推論経路の上に乗る。ただし
そちらは streaming・ハードウェア I/O・無人稼働という別要件なので**段階 2**に回す。

## 方針: 学習と同じエンジンの「別の入口」

推論用に別エンジンは作らない。既存部品を再利用する:

- `IModel::forward` — 純粋な順伝播（勾配・更新なし）
- `CheckpointModelLoader` — .pt から構造ごとモデル再構築
- `BatchTensorConverter` / `ResizePreprocessor` — 入力画像 → テンソル
- `ComputeDevice` — 推論も cpu / cuda:N を選べる（Phase 1 の抽象がそのまま効く）

### 学習と推論の決定的な違い = モデルの寿命

| | 学習 | 推論 |
|---|---|---|
| モデル | 作る → 回す → 捨てる（1 回） | **1 回ロード → N 回サーブ** |
| 呼び出し | バッチ・非同期でよい | 1 枚ずつ・低レイテンシ |
| optimizer | 必要 | 不要 |

→ 「ロード済みモデルを温めたまま持つ」層（`ResidentModelStore`）が要る。
これが無いと毎リクエストで .pt を読み直して遅い。

## ディレクトリ構成（追加分）

```
src/training/
  entities/domain-objects/
    InferenceResult.hpp          # 予測の値型(セグメンテーションマスク / クラス別確信度)
  application/
    interfaces/IInferenceEngine.hpp   # ポート: ModelHandle + 入力 → InferenceResult
    impl/RunInferenceUsecase.{hpp,cpp}  # 前処理 → engine.infer → 後処理
  infrastructure/torchModel/
    ResidentModelStore.{hpp,cpp}   # ★checkpoint パスをキーにモデルを常駐
    TorchInferenceEngine.{hpp,cpp} # IInferenceEngine の libtorch 実装
src/api/grpc/
  InferenceServiceImpl.{hpp,cpp}   # Infer RPC(段階1) / InferStream(段階2)
apps/backend/proto/
  inference.proto
```

依存方向は従来どおり。`torch::*` は infrastructure 止まり、生成コードは
adapter 止まり。

## 段階 1: 単画像推論 + GUI プレビュー（先にやる）

研究ループを回すための最小実装。

### `InferenceResult`（entity）

```cpp
struct InferenceResult {
    // [H,W] のクラス ID マスク(セグメンテーション)。CPU 上の値として返す。
    std::vector<int32_t> classMask;
    int height = 0;
    int width = 0;
    // 任意: クラス別の平均確信度など、GUI 表示に使う軽い集計
};
```

libtorch テンソルを entity に持ち込まない（Phase 1 の `ComputeDevice` と同じ方針）。

### `ResidentModelStore`（infrastructure）

- `ModelHandle load(const std::string &checkpointPath, const ComputeDevice &device)`
  — 既にロード済みなら再利用、無ければ `CheckpointModelLoader` で構築して常駐
- `void evict(ModelHandle)` / `void clear()`
- `setEval()` を必ず呼ぶ（BatchNorm / Dropout の推論モード）
- `torch::NoGradGuard` 下で forward

### `RunInferenceUsecase`（application）

1. 入力画像 → `ResizePreprocessor`（学習と同じ前処理。Letterbox 余白の扱いも合わせる）
2. `IInferenceEngine::infer(handle, tensor)` → ロジット
3. `argmax(1)` → クラス ID マスク → `InferenceResult`
4. 最終活性化（softmax 等）は「確信度が欲しいとき」だけ後処理で掛ける

### gRPC `inference.proto`（段階 1）

```proto
service Inference {
  rpc Infer(InferRequest) returns (InferResponse);
}
message InferRequest {
  string checkpoint_path = 1;   // どの学習済みモデルを使うか
  string device = 2;            // "cpu" / "cuda:N"(空なら既定)
  bytes  image = 3;             // エンコード済み画像(PNG/JPEG)
}
message InferResponse {
  int32 height = 1;
  int32 width = 2;
  bytes class_mask = 3;         // height*width の uint8/int32 パック
  repeated float per_class_confidence = 4;
}
```

### GUI（段階 1 のゴール）

- 「このモデルで試し推論」ボタン → テスト画像 1 枚を投げて予測マスクを
  元画像に重ねて表示
- 学習直後の `_best.pt` をワンクリックで対象にできる
- これで「構造いじる → 学習 → すぐ見る」が回る

## 段階 2: streaming / センサ用途（別途、gRPC 推論が安定してから）

- server-streaming `InferStream(stream Frame) returns (stream InferResponse)`
  — カメラ等の連続入力
- カメラ取り込み・信号出力の infrastructure レイヤー（ハードウェア I/O 境界）
- ヘッドレス起動、起動時自己診断、モデル欠損時の挙動
- 軽量デプロイ: ONNX / TensorRT 書き出しで学習スタック無し運用（さらに別 issue）

出力契約（`InferResponse`）は段階 1 で `v1` を固めておき、段階 2 で壊さない。

## タスク

### 段階 1

- [ ] `InferenceResult` entity
- [ ] `IInferenceEngine` ポート + `TorchInferenceEngine` 実装
- [ ] `ResidentModelStore`（ロード / 常駐 / evict、`setEval` + `NoGradGuard`）
- [ ] `RunInferenceUsecase`（前処理は学習と共通経路）
- [ ] `apps/backend/proto/inference.proto`（`Infer` unary）
- [ ] `InferenceServiceImpl`（gRPC adapter）
- [ ] Rust: `Infer` を叩くクライアント経路（`training-api` に追加）
- [ ] フロント: 試し推論ボタン + マスク重ね表示
- [ ] スモークテスト: 学習 → `_best.pt` → `RunInferenceUsecase` で有限なマスクが返る
      （`training_smoke_test` の延長、CPU で実行）

### 段階 2（着手前に別 issue へ分割）

- [ ] `InferStream` server-streaming
- [ ] カメラ取り込み / 信号出力の infrastructure
- [ ] ヘッドレス・自己診断
- [ ] ONNX / TensorRT export

## アーキテクチャ上の注意

- `IModel::forward` は既存。推論のために学習用メソッド（`trainStep` 等）を
  触らない
- `ResidentModelStore` はスレッド安全性を考える（gRPC は複数リクエスト同時）。
  段階 1 は「1 モデル・逐次」で始め、必要になったら mutex / モデルごとのキュー
- 前処理を学習と推論で**必ず同じ経路**にする（`ResizePreprocessorFactory` を
  共有）。ズレると学習時と推論時で入力分布が変わる
- device は `ComputeDevice` で受け、`ensureComputeDeviceAvailable` で検証

## 関連

- `gpu-support.md` — `ComputeDevice` / device 検証（推論でも同じものを使う）
- `grpc-layer.md` — gRPC 足回り。本 issue はその上に `Inference` サービスを足す
- `docs/checkpoint-rebuild.md` — `CheckpointModelLoader`（推論のモデルロード元）
- `fix/evaluator-ignore-index` — 予測マスクを見れないと指標だけでは分からない、の実例

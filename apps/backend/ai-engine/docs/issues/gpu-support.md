# feat: 処理の GPU 化（デバイス対応）と CUDA 整合性チェック

## 前提
- チェック対象は **ai-engine コンテナが動くサーバーの GPU**（エンドユーザー端末ではない）
- 実際に CUDA が使えるかを知っているのは libtorch を持つ C++ 側のみ。
  Rust は C++ から受け取った情報でポリシー判断を行う。

## 役割分担

### C++ (ai-engine) — 唯一の正
`GetCapabilities` gRPC を用意し、以下を返す:
- `cuda_available`（`torch::cuda::is_available()`）
- `device_count`（`torch::cuda::device_count()`）
- ビルド時 CUDA / cuDNN バージョン
- 各デバイスの名前・compute capability・VRAM

### Rust — ポリシー / バリデーション層
- 「GPU 指定されたが `cuda_available=false`」を弾く
- device index の存在チェック
- ユーザー向けエラーメッセージ生成
- 起動時に capability を取得しキャッシュ
- （任意）エンジン接続前の軽量プリフライト。`nvidia-smi` パースは壊れやすいので補助に留める

## C++ 側のデバイス対応
- `TrainParam` もしくは新 entity に `device`（cpu / cuda:N）を保持
- `TorchModel` / 各 Optimizer / 入力・ターゲットテンソルを `.to(device)` する経路を通す
- `TorchLayerBuilder` で生成する層のパラメータも生成時にデバイス配置
- チェックポイント保存/復元時の device 跨ぎ（`map_location` 相当）を考慮

## タスク
- [ ] `.proto` 定義（gRPC 層の最初の一歩を兼ねる）
- [ ] C++: `GetCapabilities` RPC 実装
- [ ] C++: device 抽象の導入と学習経路全体への適用
- [ ] C++: チェックポイントの device 跨ぎロード
- [ ] Rust: capability 取得・キャッシュ
- [ ] Rust: device 指定のバリデーションとエラーメッセージ
- [ ] テスト: CPU / CUDA 両方で学習が回ること、CUDA 不在時に適切に失敗すること

## 順序上のメモ
タスク1（`.proto`）は gRPC 層（Rust ↔ C++）の着手そのもの。
GPU 化と API 層を同時に進める形になる。

## アーキテクチャ上の注意
依存方向 entities → application → adapters → infrastructure を維持。
`torch::Device` などの libtorch 型は infrastructure 層に閉じ、
上位層へは自前の device 表現（enum + index）で渡す。

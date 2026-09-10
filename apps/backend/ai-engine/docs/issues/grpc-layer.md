# feat: gRPC 層と Rust サービスの立ち上げ（GPU capability を最初の RPC に）

ブランチ: `feat/gRPC-function` / GPU 対応 issue（`gpu-support.md`）の **Phase 2**。

## 背景

Phase 1 で C++ 内のデバイス抽象（`ComputeDevice` → `torch::Device`、各層への
`.to(device)`、checkpoint の device 跨ぎ、起動時 CUDA チェック）が完了した。

Phase 2 は「Rust ↔ C++ を gRPC でつなぐ」层そのものの立ち上げ。まだ 1 行も
存在しないため、**最小の RPC（`GetCapabilities`）を通すことを口実に gRPC の
足回りを作る**のがゴール。機能を増やすのは別 issue。

CLAUDE.md の方針（再掲）:

- 深層学習処理（C++/libtorch）と Rust は**コンテナを分け、gRPC の API のみでやり取り**
- Rust はフロントエンドと API 接続、C++ は学習アルゴリズム
- デプロイは最終的にサーバー上

## スコープ

含む:

- `.proto` 定義（共有）
- C++: gRPC サーバーの起動 + `GetCapabilities` 実装
- Rust: 新規 crate（gRPC クライアント + device バリデーションのポリシー層）
- devcontainer を 2 サービス構成へ

含まない（別 issue）:

- 学習の開始 / 進捗 / 停止といった本体 RPC
- フロントエンド連携
- クライアントローカル版（Tauri サイドカー）の外殻

## ディレクトリ構成

```
apps/backend/
  proto/
    capabilities.proto          # 共有契約。C++ / Rust 両方がここから生成
  ai-engine/                    # 既存 C++
    src/
      api/grpc/                 # ★新規: inbound adapter(gRPC サーバー)
        CapabilitiesServiceImpl.{hpp,cpp}
        GrpcServer.{hpp,cpp}    # サーバー起動・shutdown
      training/
        application/interfaces/
          ICapabilityProvider.hpp   # ★新規: application が握るポート
        infrastructure/torchFunc/
          CudaCapabilityProvider.{hpp,cpp}  # ★新規: torch::cuda::* 実装
    main.cpp                    # gRPC サーバーモードの起動を追加
  training-api/                 # ★新規 Rust crate
    Cargo.toml
    build.rs                    # tonic-build で proto 生成
    src/
      domain/                   # DeviceRequest / Capabilities など(生成コード非依存)
      application/              # ポリシー: device 指定のバリデーション
      adapters/grpc/            # tonic クライアント。生成コード <-> domain 変換
      infrastructure/           # 設定読み込み、capability キャッシュ
      main.rs
```

### 原則

- **`.proto` は `ai-engine/` の外**。2 サービス共通の契約を片方に埋めない。
- **生成コードは adapter / infrastructure 止まり**。C++ の `application` / `entities`、
  Rust の `domain` / `application` は protobuf 型を触らない。境界で
  「生成メッセージ ↔ ドメイン型」に変換する。
- gRPC サーバーは **inbound adapter**。RPC を受けて application のポートを呼ぶだけ。
  `torch::cuda::*` を直接叩くのは infrastructure の `CudaCapabilityProvider`。
- `src/api/` は `src/training/` と同階層。capability は training 専用の関心事では
  ないため training の内側に閉じない。

## `.proto`（最小案）

```proto
syntax = "proto3";
package aiengine.v1;

service Capabilities {
  rpc GetCapabilities(GetCapabilitiesRequest) returns (GetCapabilitiesResponse);
}

message GetCapabilitiesRequest {}

message GetCapabilitiesResponse {
  bool   cuda_available   = 1;
  uint32 device_count     = 2;
  string torch_version    = 3;
  string cuda_build_version = 4;   // libtorch のビルド時 CUDA
  string cudnn_build_version = 5;
  repeated CudaDevice devices = 6;
}

message CudaDevice {
  uint32 index                  = 1;
  string name                   = 2;
  uint32 compute_capability_major = 3;
  uint32 compute_capability_minor = 4;
  uint64 total_memory_bytes      = 5;
}
```

バージョニングは `package aiengine.v1;` で始める。破壊的変更は `v2` を切る。

## C++ 側

### 1. ビルド基盤

- Dockerfile（`.devcontainer/Dockerfile`）に追加:
  `libgrpc++-dev` `libprotobuf-dev` `protobuf-compiler` `protobuf-compiler-grpc`
- `CMakeLists.txt`: `find_package(gRPC CONFIG REQUIRED)` / `find_package(Protobuf REQUIRED)`、
  `protobuf_generate` + gRPC プラグインで `capabilities.proto` から `.pb.cc` / `.grpc.pb.cc`
  を `build/` に生成。生成物はコミットしない。
- リンクの重さ対策: gRPC サーバーは `ai_engine_app` に統合するか、別ターゲット
  `ai_engine_grpc` に分けるか要検討（`-j2` 制約下でのビルド時間）。

### 2. `ICapabilityProvider`（application ポート）

```cpp
// application/interfaces/ICapabilityProvider.hpp — libtorch 非依存
struct CapabilitySnapshot {
    bool cudaAvailable = false;
    unsigned int deviceCount = 0;
    std::string torchVersion;
    std::string cudaBuildVersion;
    std::string cudnnBuildVersion;
    std::vector<CudaDeviceInfo> devices;  // index/name/cc/vram を持つ値型
};

class ICapabilityProvider {
public:
    virtual ~ICapabilityProvider() = default;
    virtual CapabilitySnapshot snapshot() const = 0;
};
```

### 3. `CudaCapabilityProvider`（infrastructure 実装）

`torch::cuda::is_available()` / `device_count()` / `at::cuda::getDeviceProperties(i)`、
`TORCH_VERSION` マクロ等から `CapabilitySnapshot` を組む。

### 4. `CapabilitiesServiceImpl`（gRPC adapter）

生成された `Capabilities::Service` を継承。`GetCapabilities` で
`_provider->snapshot()` を呼び、`CapabilitySnapshot` → protobuf レスポンスに変換。

### 5. `main.cpp`

`--serve` などのフラグ（or 別バイナリ）で gRPC サーバーモード起動。
既存の「config を読んで学習」経路はそのまま残す（Phase 2 では学習 RPC は無い）。

### 6. Phase 1 の起動時チェックの扱い

`ensureComputeDeviceAvailable`（`DeviceToTorch.cpp`）は**残す**。
Rust プリフライトが本線になるが、C++ 単体起動・多層防御として維持。

## Rust 側

### crate: `training-api`

- `tonic` + `prost`、`build.rs` で `../proto/capabilities.proto` を生成
- クリーンアーキテクチャ（entity から）:

| 層 | 責務 |
|---|---|
| `domain` | `DeviceRequest`（`cpu` / `cuda:N`）、`Capabilities`、`DeviceValidationError`。生成コード非依存 |
| `application` | ポリシー: 「`cuda` 指定だが `cuda_available=false`」「index が `device_count` 以上」を弾き、ユーザー向けメッセージを生成 |
| `adapters/grpc` | tonic クライアント。protobuf メッセージ ↔ `domain` 変換。capability 取得 |
| `infrastructure` | 設定読み込み、起動時に capability を 1 回取得してキャッシュ |

### やること

- 起動時に `GetCapabilities` を叩いて capability をキャッシュ
- device 指定（config / 将来は API リクエスト）を `application` のポリシーで検証
- **サーバー版の方針**: 検証 NG は**エラーで停止**（gpu-support.md の
  「黙って CPU に落とさない」を Rust 側に移設）
- クライアントローカル版は「停止せず利用可能な device 一覧を返す」動作になるが
  それは別 issue。ポリシー関数自体は共有できるよう、判定結果の**扱い**を
  呼び出し側の責務として切り出しておく

## devcontainer

`.devcontainer/docker-compose.yml` を 2 サービスへ:

```yaml
services:
  ai-engine-dev:      # 既存。gRPC サーバーもここで動かす。50051 を expose
  training-api-dev:   # 新規。Dockerfile.rust(rustup + protobuf-compiler)
    depends_on: [ai-engine-dev]
```

- devcontainer の主サービスは **C++（`ai-engine-dev`）のまま**。Rust は
  `runServices` で併立、または個別に `docker compose exec` で開発
- サービス間: `training-api-dev` → `ai-engine-dev:50051`

## 進め方（順序）

1. `apps/backend/proto/capabilities.proto`
2. C++ Dockerfile に gRPC/protobuf 追加 → CMake で生成 → **空の gRPC サーバーが
   起動して `grpc_cli` で疎通するところまで**
3. C++: `ICapabilityProvider` + `CudaCapabilityProvider` + `GetCapabilities` ハンドラ
4. Rust: コンテナ + crate 雛形 → tonic クライアントで `GetCapabilities` を
   叩けるところまで
5. Rust: `domain` + `application` のポリシー層（device バリデーション）
6. B-5 の役割を Rust プリフライトへ（C++ チェックは多層防御で残す）

各ステップでビルド確認（`-j2`）。gRPC 導入で C++ のビルド時間が増えるため、
gRPC を別ターゲットに分けるか早めに判断する。

## タスク

- [ ] `apps/backend/proto/capabilities.proto`
- [ ] `.devcontainer/Dockerfile`: gRPC / protobuf 追加
- [ ] `.devcontainer/Dockerfile.rust` + `docker-compose.yml` 2 サービス化
- [ ] `CMakeLists.txt`: proto 生成 + gRPC リンク（別ターゲット要否の判断込み）
- [ ] C++: `ICapabilityProvider` / `CudaCapabilityProvider`
- [ ] C++: `CapabilitiesServiceImpl` / `GrpcServer` / `main.cpp` のサーバーモード
- [ ] Rust: `training-api` crate（`build.rs` で proto 生成）
- [ ] Rust: `adapters/grpc` クライアント → `GetCapabilities` 疎通
- [ ] Rust: `domain` + `application`（device バリデーションポリシー）
- [ ] 統合: Rust プリフライト → NG ならエラー停止（サーバー版方針）
- [ ] `gpu-support.md` の Phase 2 セクションから本 issue へリンク

## アーキテクチャ上の注意

- 依存方向 `entities → application → adapters → infrastructure` を C++ / Rust 両方で維持
- 生成コード（protobuf / tonic）は **adapter・infrastructure に閉じる**
- `torch::*` は従来どおり C++ の infrastructure だけ
- `clean-arch-lint` は C++ 側にのみ効く。Rust 側は crate 内の module 構成で担保

## 関連

- `docs/issues/gpu-support.md` — Phase 1（完了）。B-5 の起動時チェックを Rust へ寄せる
- `CLAUDE.md` — コンテナ分離 / gRPC のみ / デプロイ方針
- `gpu-support.md` の「実行環境別の GPU 実装見通し」— サーバー版 / クライアント版で
  ポリシーの「出力の扱い」が分岐する整理

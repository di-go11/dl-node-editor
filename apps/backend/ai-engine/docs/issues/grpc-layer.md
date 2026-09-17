# feat: gRPC 層と Rust サービスの立ち上げ（GPU capability を最初の RPC に）

ブランチ: `feat/gRPC-function` / GPU 対応 issue（`gpu-support.md`）の **Phase 2**。

> **2026-09-11 時点の進捗**: C++ 側（`.proto` / gRPC サーバー / `GetCapabilities`）は
> 実装・ビルド・`grpcurl` での疎通確認まで完了。**Rust 側（`api` crate。当初
> `training-api` の名前で計画していたが、学習専用ではなくフロントエンド向け
> バックエンドAPI全体を担うため `api` に改名）と devcontainer の 2 サービス化は
> `training-api-setup.md` に切り出した**（本ファイルは
> C++ 側完了分の記録として完結させる）。詳細は「進捗メモ」節を参照。

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

実際に出来上がった構成（C++ 側。Rust はまだ無い）:

```
apps/backend/
  proto/
    capabilities.proto          # 共有契約。C++ / Rust 両方がここから生成
  ai-engine/
    src/
      main.cpp                  # 合成層。--serve で GrpcApp、それ以外は TrainingApp
      api/grpc/                 # inbound adapter(gRPC サーバー)。生成コードに触れてよいのはここだけ
        GrpcApp.{hpp,cpp}       # composition root: CudaCapabilityProvider + CapabilitiesServiceImpl + GrpcServer
        GrpcServer.{hpp,cpp}    # ServerBuilder のラッパ。起動・Wait・shutdown
        CapabilitiesServiceImpl.{hpp,cpp}  # Capabilities::Service 実装
      training/
        TrainingApp.{hpp,cpp}   # 学習側の composition root(旧 main.cpp の中身)
        application/interfaces/
          ICapabilityProvider.hpp          # application が握るポート
        infrastructure/torchFunc/
          CudaCapabilityProvider.{hpp,cpp} # torch::cuda::* 実装
  api/                           # ★未着手: 新規 Rust crate（当初 training-api の名前で計画。詳細は training-api-setup.md）
    Cargo.toml
    build.rs                    # tonic-build で proto 生成
    src/
      domain/                   # DeviceRequest / Capabilities など(生成コード非依存)
      application/              # ポリシー: device 指定のバリデーション
      adapters/grpc/            # tonic クライアント。生成コード <-> domain 変換
      infrastructure/           # 設定読み込み、capability キャッシュ
      main.rs
```

計画との違いは「進捗メモ」節を参照（`main.cpp` の位置・`GrpcApp` の追加・
`ai_engine_grpc` が `ai_engine_lib` をリンクしない制約など）。

### 原則

- **`.proto` は `ai-engine/` の外**。2 サービス共通の契約を片方に埋めない。
- **生成コードは adapter / infrastructure 止まり**。C++ の `application` / `entities`、
  Rust の `domain` / `application` は protobuf 型を触らない。境界で
  「生成メッセージ ↔ ドメイン型」に変換する。
- gRPC サーバーは **inbound adapter**。RPC を受けて application のポートを呼ぶだけ。
  `torch::cuda::*` を直接叩くのは infrastructure の `CudaCapabilityProvider`。
- `src/api/` は `src/training/` と同階層。capability は training 専用の関心事では
  ないため training の内側に閉じない。

## `.proto`（実装済み。最小案より簡略化）

`apps/backend/proto/capabilities.proto`。パッケージ名は `capabilities.v1`
（計画時の `aiengine.v1` から変更。「このプロトは capability 専用」であることを
名前で明示するため）。リクエストは既存の Well-Known Type `google.protobuf.Empty`
を使い、専用の `GetCapabilitiesRequest` は作らなかった。

```proto
syntax = "proto3";
import "google/protobuf/empty.proto";

package capabilities.v1;

enum DeviceType {
    DEVICE_TYPE_UNSPECIFIED = 0;
    DEVICE_TYPE_CPU = 1;
    DEVICE_TYPE_CUDA = 2;
}

message DeviceInfo {
    string device_name = 1;
    uint32 device_index = 2;   // 計画時は optional だったが、システムの protoc(3.12.4)が
                                // proto3 optional に非対応のため外した(下記参照)
    DeviceType device_type = 3;
}

message CapabilitiesResponse {
    bool cuda_available = 1;
    repeated DeviceInfo devices = 2;
}

service Capabilities {
    rpc GetCapabilities(google.protobuf.Empty) returns (CapabilitiesResponse);
}
```

**計画からの縮小**: `device_count` / `torch_version` / `cuda_build_version` /
`cudnn_build_version` / `compute_capability_major/minor` / `total_memory_bytes`
は実装していない。`device_count` は `devices` の要素数で代替可能、他はまだ
使う予定が無いため後回し。要る場面が出たら `v1` に**フィールド追加**（既存
フィールド番号は変えない）で拡張する。バージョニングは `package capabilities.v1;`
のとおり。破壊的変更は `v2` を切る。

## C++ 側（実装済み）

### 1. ビルド基盤

- Dockerfile（`.devcontainer/Dockerfile`）に追加:
  `libgrpc++-dev` `libprotobuf-dev` `protobuf-compiler` `protobuf-compiler-grpc`、
  加えて疎通確認用に **`grpcurl`**（apt に無いので GitHub リリースのバイナリを
  バージョン固定でダウンロード）。
- `CMakeLists.txt`: 当初案の `find_package(gRPC CONFIG REQUIRED)` は
  **Ubuntu 22.04 の `libgrpc++-dev`(1.30.2) が CMake Config を提供せず失敗**したため、
  pkg-config 経由に変更（`gRPC::grpc++` / `gRPC::grpc_cpp_plugin` という同名の
  imported target を自作して差し替え）。`Protobuf` も同様に一癖あった
  （「進捗メモ」参照）。生成物は `build/protoGenerated/` に集約し、コミットしない。
- リンク方針: **別ターゲット `ai_engine_grpc` に分けた**。これは単なるビルド時間対策
  ではなく、`ai_engine_lib`(torch)をリンクしないことが**必須の制約**になった
  （「進捗メモ」参照）。

### 2. `ICapabilityProvider`（application ポート）

実装（`src/training/application/interfaces/ICapabilityProvider.hpp`）:

```cpp
struct DeviceSnapshot {
    std::string name;
    ComputeDeviceType type;
    int index = 0;
};

struct CapabilitySnapshot {
    bool cudaAvailable = false;
    std::vector<DeviceSnapshot> devices;
};

class ICapabilityProvider {
public:
    virtual ~ICapabilityProvider() = default;
    virtual CapabilitySnapshot snapshot() const = 0;
};
```

計画時の `deviceCount` / `torchVersion` / `cudaBuildVersion` / `cudnnBuildVersion`
は無し（`.proto` の縮小に合わせた）。`ComputeDeviceType` は Phase 1 の
`ComputeDevice.hpp`（entities）をそのまま再利用している。

### 3. `CudaCapabilityProvider`（infrastructure 実装）

`torch::cuda::is_available()` / `device_count()` から `CapabilitySnapshot` を組む
（`src/training/infrastructure/torchFunc/CudaCapabilityProvider.cpp`）。
`at::cuda::getDeviceProperties` 等の詳細情報は `.proto` を縮小したため未使用。

### 4. `CapabilitiesServiceImpl`（gRPC adapter）

生成された `capabilities::v1::Capabilities::Service` を継承。コンストラクタで
`ICapabilityProvider&` を DI で受け取る（具象 `CudaCapabilityProvider` は知らない）。
`ComputeDeviceType` → `capabilities::v1::DeviceType` の変換は、生成 enum を
他層に漏らさないためこの `.cpp` 内の無名 namespace に閉じている。

### 5. `main.cpp` → `src/main.cpp` + `GrpcApp` / `TrainingApp`

計画より一段整理した。旧 `main.cpp`(学習の全ロジックを直書き)を
`src/training/TrainingApp.cpp`(`runTraining()`)に切り出し、対称的に
`src/api/grpc/GrpcApp.cpp`(`runGrpcServer()`。`CudaCapabilityProvider` +
`CapabilitiesServiceImpl` + `GrpcServer` の DI 配線)を新設。
`src/main.cpp` はどちらを呼ぶかを `--serve` フラグで振り分けるだけの薄い層。

```cpp
// src/main.cpp
int main(int argc, char **argv)
{
    const bool serve = (argc > 1 && std::string(argv[1]) == "--serve");
    if (serve) runGrpcServer(); else runTraining();
    return 0;
}
```

`GrpcApp.cpp` は `ai_engine_grpc` 側に置く（`ai_engine_app` ではない）。
理由は「進捗メモ」の CMake 制約を参照。

### 6. Phase 1 の起動時チェックの扱い

`ensureComputeDeviceAvailable`（`DeviceToTorch.cpp`）は**残した**。
`runTraining()` から呼ばれる。Rust プリフライトが本線になる予定だが、
C++ 単体起動・多層防御として維持。

## Rust 側 / devcontainer 2 サービス化

`training-api-setup.md` に分離した（crate 構成・各層の責務・devcontainer
設定・進め方の詳細はそちらを参照）。ここでは要点のみ:

- crate: `apps/backend/api/`（`tonic` + `prost`、クリーンアーキテクチャ）
- devcontainer: `api-dev` サービスを追加し 2 サービス構成へ
- サーバー版の方針: device バリデーション NG は**エラーで停止**
  （`gpu-support.md` の「黙って CPU に落とさない」を Rust 側に移設）

## 進め方（順序、C++ 側）

1. ~~`apps/backend/proto/capabilities.proto`~~ **完了**
2. ~~C++ Dockerfile に gRPC/protobuf 追加 → CMake で生成 → 空の gRPC サーバーが
   起動して疎通するところまで~~ **完了**（`grpc_cli` ではなく `grpcurl` を使用）
3. ~~C++: `ICapabilityProvider` + `CudaCapabilityProvider` + `GetCapabilities` ハンドラ~~
   **完了**（`grpcurl` で実応答まで確認済み）

以降（Rust crate 雛形 → tonic クライアント疎通 → ポリシー層 → 統合）は
`training-api-setup.md` を参照。

各ステップでビルド確認（`-j2`）。gRPC 導入で C++ のビルド時間が増えるため、
gRPC を別ターゲットに分けるか早めに判断する。

## タスク（C++ 側。Rust 側は `training-api-setup.md` を参照）

- [x] `apps/backend/proto/capabilities.proto`
- [x] `.devcontainer/Dockerfile`: gRPC / protobuf 追加（+ `grpcurl` 追加、計画外）
- [x] `CMakeLists.txt`: proto 生成 + gRPC リンク（`ai_engine_grpc` に分離。
      理由は必須制約、詳細は進捗メモ）
- [x] C++: `ICapabilityProvider` / `CudaCapabilityProvider`
- [x] C++: `CapabilitiesServiceImpl` / `GrpcServer` / `GrpcApp` /
      `src/main.cpp` の `--serve` サーバーモード
- [x] 動作確認: `grpcurl` で `GetCapabilities` を実行し
      `cudaAvailable` / `devices`(cpu, cuda:0) が正しく返ることを確認
- [x] 既存テスト（10本）が無改修で通ることを確認
- [x] `gpu-support.md` の Phase 2 セクションから本 issue へリンク
- [ ] → 続きは `training-api-setup.md`（devcontainer 2 サービス化 /
      `api` crate / tonic クライアント / device バリデーション）

## 進捗メモ（2026-09-11、C++ 側完了分）

実装は計画どおり進んだが、**CMake / ビルド周りで3つ想定外の問題**を踏んだ。
将来 Rust 側や別の RPC を追加するときに同じ問題を踏まないための記録。

### 1. `find_package(gRPC CONFIG REQUIRED)` が失敗する

Ubuntu 22.04 の `libgrpc++-dev`(apt, 1.30.2)は `gRPCConfig.cmake` を提供せず
pkg-config の `.pc` のみ。`pkg_check_modules(... IMPORTED_TARGET grpc++)` で
見つけ、`gRPC::grpc++` / `gRPC::grpc_cpp_plugin` という**同名**の target を
自作して差し替えた（呼び出し側のコードは無変更で済む）。

### 2. `protobuf::libprotobuf` にリンクしても実体が空

`find_package(Torch)` が内部で読む `Caffe2Config.cmake` が、
「`protobuf::libprotobuf` という名前がまだ無ければ中身の無いダミーを作る」処理を
**先に**実行してしまう。後から呼ぶ `find_package(Protobuf)` は「その名前は既にある」
と見なして本物に差し替えない（`FindProtobuf.cmake` 側にも同種のガードがある）。
結果、最終リンクで `undefined reference to google::protobuf::Message` になる。
`protobuf::libprotobuf` という名前は諦め、pkg-config 経由で別名
`SystemProtobuf::libprotobuf` を用意して使っている。

加えて devcontainer の環境変数 `CMAKE_PREFIX_PATH=/opt/libtorch` が
`find_package(Protobuf)` の探索に混ざり、libtorch 同梱の(バージョンが違う)
protobuf ヘッダを拾ってしまう問題もあった
（`unset(ENV{CMAKE_PREFIX_PATH})` は CMake が起動時に取り込み済みで効かない）。
`Protobuf_INCLUDE_DIR` 等をキャッシュに直接ピン留めして探索自体を回避した。

### 3. `ai_engine_lib`(STATIC, torch を PRIVATE リンク)の使用要件が伝播する

STATIC ライブラリの PRIVATE 依存(ここでは torch)の使用要件(include dirs)は、
CMake の仕様上それをリンクする側にも伝播してしまう(静的リンクは最終的な
実行ファイルが全依存を知る必要があるための既知の制約で、`target_include_directories`
側の工夫では回避できないことを実験で確認済み)。これにより **`ai_engine_lib` を
リンクした翻訳単位はどれも、libtorch 同梱の protobuf ヘッダが `-isystem` で
紛れ込み、生成コード(`capabilities.grpc.pb.h` 経由で `source_context.pb.h` 等)と
衝突する**。

対処は「`ai_engine_lib` をリンクしない」の一択:
- `ai_engine_grpc`(`GrpcServer.cpp` / `CapabilitiesServiceImpl.cpp` /
  `GrpcApp.cpp`)は `ai_engine_lib` を **リンクしない**
- `GrpcApp.cpp` が使う `CudaCapabilityProvider.hpp` は torch 非依存のヘッダ
  (メンバも無い)なのでコンパイルは通る。実体(`.cpp`、torch 使用)のシンボル解決は
  両方をリンクする最終実行ファイル `ai_engine_app` の段階で行われる
- ただし `ai_engine_app` の最終リンクでは**リンク順**が重要: `ai_engine_grpc`
  (`CudaCapabilityProvider` を要求する側)を `ai_engine_lib`(提供する側)より
  **先**に書く必要がある(静的リンクは左から右へ一方向にしか未解決シンボルを
  探さないため、逆順だと `undefined reference to vtable for
  CudaCapabilityProvider` になる)

### この制約が今後に効いてくる点

将来 `Inference` サービス等を追加するとき、その adapter 実装
（`InferenceServiceImpl` 等）も **`ai_engine_lib` を直接リンクしてはいけない**。
具象 infrastructure クラス（`TorchInferenceEngine` 等）は `ICapabilityProvider`
と同じパターンで interface 越しに DI し、実体の組み立ては `GrpcApp.cpp` のような
composition root（`ai_engine_grpc` 側、`CudaCapabilityProvider.hpp` のように
torch 非依存なヘッダしか include しない前提）に置く。

## アーキテクチャ上の注意

- 依存方向 `entities → application → adapters → infrastructure` を C++ / Rust 両方で維持
- 生成コード（protobuf / tonic）は **adapter・infrastructure に閉じる**
- `torch::*` は従来どおり C++ の infrastructure だけ
- `clean-arch-lint` は C++ 側にのみ効く。Rust 側は crate 内の module 構成で担保

## 関連

- `docs/issues/training-api-setup.md` — 本 issue の続き（Rust 側 / devcontainer 2 サービス化）
- `docs/issues/gpu-support.md` — Phase 1（完了）。B-5 の起動時チェックを Rust へ寄せる
- `CLAUDE.md` — コンテナ分離 / gRPC のみ / デプロイ方針
- `gpu-support.md` の「実行環境別の GPU 実装見通し」— サーバー版 / クライアント版で
  ポリシーの「出力の扱い」が分岐する整理

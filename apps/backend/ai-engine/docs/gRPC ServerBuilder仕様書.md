# gRPC ServerBuilder 仕様書

`grpc::ServerBuilder` — gRPC C++ で **サーバーを1つ組み立てて起動する**ための builder クラス。
`GrpcServer`（[src/api/grpc/GrpcServer.hpp](../src/api/grpc/GrpcServer.hpp)）の実装で直接使う。
`.proto` / `service` / `rpc` の文法や `Service` 実装（`CapabilitiesServiceImpl` 側）は
[gRPCチュートリアル.md](./gRPCチュートリアル.md) を参照。本書は **サーバーの起動・待受・停止** に絞る。

---

## 1. 導入情報

| 項目 | 内容 |
|---|---|
| バージョン | **1.30.2**（Ubuntu 22.04 `libgrpc++-dev` / `libgrpc-dev`） |
| 導入元 | apt（`.devcontainer/Dockerfile`。`libgrpc++-dev` `libprotobuf-dev` `protobuf-compiler` `protobuf-compiler-grpc`） |
| CMake での検出 | `find_package(gRPC CONFIG)` は使えない（後述）。pkg-config 経由（[CMakeLists.txt](../CMakeLists.txt)） |
| 主 include | `#include <grpcpp/grpcpp.h>`（`ServerBuilder` / `Server` / `ServerContext` / `Status` 等一式） |
| クラス定義の実体 | `/usr/include/grpcpp/server_builder_impl.h`（`grpcpp/server_builder.h` から include される） |

### 1-1. なぜ `find_package(gRPC CONFIG)` が使えないか

Ubuntu 22.04 の `libgrpc++-dev`（1.30.2）は `gRPCConfig.cmake` / `gRPCTargets.cmake` を提供しない
（pkg-config の `.pc` ファイルのみ）。このため本プロジェクトでは pkg-config 経由で
`gRPC::grpc++` エイリアスを自作している。詳細と、libtorch 同梱 protobuf との
バージョン衝突の対処は [CMakeLists.txt](../CMakeLists.txt) のコメントを参照。

---

## 2. 全体の流れ

```
ServerBuilder builder;
  ├─ AddListeningPort(addr, creds)   … どのアドレス:ポートで listen するか
  ├─ RegisterService(&serviceImpl)   … .proto から生成した Service 実装を登録(複数可)
  └─ BuildAndStart()                 … 実際に Server を構築して起動(この時点で listen 開始)
        │
        ▼
  std::unique_ptr<grpc::Server> server
        │
        ├─ server->Wait()            … サーバースレッドをブロックして待ち続ける
        └─ server->Shutdown()        … (別スレッド/シグナルハンドラから)停止させる
```

`ServerBuilder` はビルド用の**一時オブジェクト**で、`BuildAndStart()` を呼んだ後は使い捨てる。
実際にサーバーとして生き続けるのは `BuildAndStart()` が返す `grpc::Server` の方。

---

## 3. 主要メンバ関数

### 3.1 `AddListeningPort`

```cpp
ServerBuilder& AddListeningPort(
    const grpc::string& addr_uri,
    std::shared_ptr<grpc::ServerCredentials> creds,
    int* selected_port = nullptr);
```

| 引数 | 意味 |
|---|---|
| `addr_uri` | 待受アドレス。`"0.0.0.0:50051"` のように書く。スキームを省くと `dns:///` 扱い。全 IPv6/IPv4 で待つなら `"[::]:50051"` |
| `creds` | 通信の暗号化方式。ローカル/開発では `grpc::InsecureServerCredentials()` で平文 |
| `selected_port` | `0`（OS が空きポートを選ぶ）を渡したとき、実際に割り当てられたポート番号がここに入る。固定ポート運用なら `nullptr` でよい |

```cpp
int port = 0;
builder.AddListeningPort("0.0.0.0:0", grpc::InsecureServerCredentials(), &port);
// BuildAndStart() 後に port を見れば実際の待受ポートが分かる(テストで便利)
```

**本プロジェクトでの使い方**: サーバー版はポート固定（`0.0.0.0:50051`）でよい。
クライアントローカル版（Tauri サイドカー）では動的ポート割り当てが要るかもしれないが Phase 2 の範囲外。

### 3.2 `RegisterService`

```cpp
ServerBuilder& RegisterService(grpc::Service* service);
```

- `.proto` の `service` ごとに生成される `<ServiceName>::Service` を継承した実装（`CapabilitiesServiceImpl`）を渡す
- **複数回呼んで複数サービスを1つの `Server` にまとめられる**（`Inference` サービスを Phase 3 で足すときはここに追加するだけ）
- 渡すのは生ポインタ。`ServerBuilder`/`Server` は所有権を取らない。**呼び出し側が service 実装の寿命を `Server` より長く保つ責任を持つ**（`GrpcServer` がメンバとして持つのが定石）

### 3.3 `BuildAndStart`

```cpp
std::unique_ptr<grpc::Server> BuildAndStart();
```

- `AddListeningPort` / `RegisterService` で積んだ設定を確定し、実際にソケットを bind してリクエスト受付を開始する
- 戻り値が `nullptr` の場合は起動失敗（ポート使用中など）。**必ずチェックする**

```cpp
std::unique_ptr<grpc::Server> server = builder.BuildAndStart();
if (!server)
{
    throw std::runtime_error("GrpcServer: failed to start (port already in use?)");
}
```

### 3.4 その他のオプション（今は使わないが知っておくもの）

| メソッド | 用途 | Phase 2 での要否 |
|---|---|---|
| `SetMaxReceiveMessageSize(int)` / `SetMaxSendMessageSize(int)` | 既定の受信/送信上限（4MB）を変更 | 不要。`GetCapabilities` は小さい応答のみ |
| `SetSyncServerOption(...)` | 同期サーバーのスレッドプール調整 | 不要（デフォルトで十分。RPC 数が増え負荷が出たら検討） |
| `SetResourceQuota(...)` | メモリ/スレッド使用量の上限 | 不要 |
| `AddCompletionQueue(...)` | 非同期(async) API 用 | 不要。今回は同期 `Service::GetCapabilities` オーバーライドのみで組む |

---

## 4. `grpc::Server` 側のメンバ

| メソッド | 意味 |
|---|---|
| `void Wait()` | 呼び出しスレッドをブロックし、`Shutdown()` されるまでリクエストを処理し続ける。**`main()` の最後で呼ぶ想定** |
| `void Shutdown()` | 新規リクエストの受付を止め、処理中の RPC が終わり次第サーバーを停止する。`Wait()` はこの呼び出しで返る |
| `void Shutdown(deadline)` | 猶予時間つきの強制停止版 |

`Shutdown()` は `Wait()` を呼んでいるスレッドとは**別スレッド**（シグナルハンドラ等）から呼ぶのが通常の使い方。

---

## 5. 本プロジェクトでの実装形

### 5.1 `GrpcServer` の役割

```cpp
// src/api/grpc/GrpcServer.hpp
class GrpcServer
{
public:
    GrpcServer(std::string address, grpc::Service &service);

    void run();       // BuildAndStart() して Wait() まで(ブロッキング)
    void shutdown();  // 別スレッド/シグナルハンドラから呼ぶ

private:
    std::string _address;
    grpc::Service &_service;               // 所有しない。呼び出し側(main.cpp)が生存を保証
    std::unique_ptr<grpc::Server> _server;  // BuildAndStart() の戻り値
};
```

```cpp
// src/api/grpc/GrpcServer.cpp
void GrpcServer::run()
{
    grpc::ServerBuilder builder;
    builder.AddListeningPort(_address, grpc::InsecureServerCredentials());
    builder.RegisterService(&_service);

    _server = builder.BuildAndStart();
    if (!_server)
    {
        throw std::runtime_error("GrpcServer: failed to bind " + _address);
    }
    _server->Wait();  // ここでブロック。shutdown() が呼ばれるまで戻らない
}

void GrpcServer::shutdown()
{
    if (_server)
    {
        _server->Shutdown();
    }
}
```

### 5.2 `main.cpp`（合成層）からの配線

`GrpcServer` は `grpc::Service&` を受け取るだけで、`CapabilitiesServiceImpl` を new しない。
具象の組み立ては合成層（`main.cpp`）の責務（[grpc-layer.md](./issues/grpc-layer.md) の DI 方針どおり）。

```cpp
CudaCapabilityProvider provider;              // infrastructure(ai_engine_lib)
CapabilitiesServiceImpl capabilitiesService(provider);  // adapter(ai_engine_grpc)
GrpcServer server("0.0.0.0:50051", capabilitiesService);
server.run();  // ブロッキング。Ctrl+C 等での終了は Phase 2 のタスク
```

### 5.3 なぜ `ai_engine_grpc` は `ai_engine_lib` にリンクしないか

`GrpcServer` / `CapabilitiesServiceImpl` は `grpc::Service` と `ICapabilityProvider`（純粋仮想）しか知らない。
`CudaCapabilityProvider`（torch 依存）を組み立てるのは `main.cpp` だけであり、`ai_engine_app` は
`ai_engine_lib` と `ai_engine_grpc` の両方にリンクしているのでそこで初めて両者が出会う。
これにより `ai_engine_grpc` の翻訳単位に libtorch 同梱の protobuf ヘッダが紛れ込む問題も同時に避けられる
（[CMakeLists.txt](../CMakeLists.txt) のコメント参照）。

---

## 6. 動作確認（`grpcurl`）

サーバーを実装できたら、専用のクライアントコードを書かなくても `grpcurl` で疎通確認できる。

```bash
# .proto の reflection を有効にしていない場合は -proto を直接渡す
grpcurl -plaintext -proto apps/backend/proto/capabilities.proto \
    -import-path apps/backend/proto \
    localhost:50051 capabilities.v1.Capabilities/GetCapabilities
```

`cuda_available` / `devices` が JSON で返れば疎通成功。

---

## 7. 今後の拡張で気をつけること

- **サービスが増えたら** `RegisterService` を並べるだけで1つの `Server`/ポートに複数サービスを乗せられる（`Inference` サービス追加時）
- **Graceful shutdown**: 現状 `main.cpp` はシグナルハンドラを持たない。SIGINT/SIGTERM で `shutdown()` を呼ぶ配線は未実装（コンテナ運用では `docker stop` の SIGTERM が素通りして強制終了される点に注意。将来のタスク）
- **ヘルスチェック**: `grpcpp/ext/health_check_service_server_builder_option.h` で標準の Health サービスを追加できる（`EnableDefaultHealthCheckService`）。Kubernetes 等での liveness probe に使うことになったら検討

## 関連

- [gRPCチュートリアル.md](./gRPCチュートリアル.md) — `.proto` 文法、`Service` 実装、クライアント側
- [issues/grpc-layer.md](./issues/grpc-layer.md) — Phase 2 全体設計、DI の方針

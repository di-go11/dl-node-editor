# gRPC C++ チュートリアル

本ドキュメントは gRPC 公式の C++ クイックスタート
（<https://grpc.io/docs/languages/cpp/quickstart/>）を日本語で整理し、
本プロジェクト（ai-engine / libtorch を gRPC で Rust バックエンドと分離する構成）
に適用する際の補足を加えたものである。

- 対象言語バージョン: C++11 以上（本プロジェクトは C++17）
- 必須ツール: `cmake` 3.16 以上
- 想定所要時間: 約 30 分

---

## 1. gRPC の基本概念

gRPC は「サービス定義」を軸にした RPC フレームワークである。

1. `.proto` ファイルに **メッセージ型** と **サービス（RPC メソッド）** を定義する
2. `protoc` + `grpc_cpp_plugin` でコードを生成する
   - `*.pb.{h,cc}` … メッセージ型（シリアライズ／デシリアライズ）
   - `*.grpc.pb.{h,cc}` … サービス基底クラス（サーバー用）とスタブ（クライアント用）
3. サーバーは基底クラスの仮想関数を `override` して実装する
4. クライアントはスタブのメソッドを呼ぶだけで RPC が飛ぶ

RPC は 4 種類ある。

| 種類 | .proto の書き方 | 用途の例 |
| --- | --- | --- |
| 単項 (Unary) | `rpc F(Req) returns (Res)` | 1 リクエスト → 1 レスポンス |
| サーバーストリーミング | `rpc F(Req) returns (stream Res)` | 学習の進捗（loss/epoch）を逐次通知 |
| クライアントストリーミング | `rpc F(stream Req) returns (Res)` | データを分割アップロード |
| 双方向ストリーミング | `rpc F(stream Req) returns (stream Res)` | 対話的な制御 |

### 1.1 `.proto` / `service` / `rpc` の粒度 — ファイルは API ごとに作らない

よくある誤解: 「config を送る API」「loss を逐次受け取る API」ごとに `.proto` を
作るのか？ → **違う。** 粒度は 3 段階に分かれる。

```
.proto ファイル   ← ドメイン（関心事）単位     例: training.proto
  └ service       ← 関連する操作のまとまり       例: TrainingService
      └ rpc       ← 個々の操作（1 メソッド = 1 API）
```

「config を送って完了を受け取る」も「loss を逐次受け取る」も、**同じ `service` 内の
別々の `rpc`**。通信パターン（1 往復 / ストリーミング）は `rpc` の `stream` 有無で
決まるだけで、ファイルもサービスも分けない。

```protobuf
syntax = "proto3";
package aiengine.training.v1;

service TrainingService {
  rpc StartTraining(StartTrainingRequest) returns (StartTrainingResponse);      // 1往復
  rpc StreamProgress(StreamProgressRequest) returns (stream ProgressUpdate);    // サーバーストリーミング
  rpc StopTraining(StopTrainingRequest) returns (StopTrainingResponse);         // 1往復
  rpc GetJobStatus(GetJobStatusRequest) returns (JobStatus);                    // 1往復
}
```

#### ファイルを分ける基準 = ドメインごと（RPC ごとではない）

| ファイル | service | 分ける理由 |
| --- | --- | --- |
| `capabilities.proto` | `Capabilities` | GPU 情報・レジストリ一覧。学習とは別の関心事 |
| `training.proto` | `TrainingService` | 学習の開始 / 進捗 / 停止をまとめる |
| `inference.proto` | `InferenceService` | 推論。学習済みモデルを使う別入口 |
| `common.proto` | （service なし） | `Device` / `Error` など複数ファイルで共有する message |

本プロジェクトのロードマップの Phase 2 / 3 / 4 が、それぞれ
`capabilities.proto` / `training.proto` / `inference.proto` に対応する
（`docs/issues/開発ロードマップ.md`）。

#### RPC を1つの service にまとめる目安

- 同じライフサイクル・同じリソース（ここでは学習 job）を扱う操作は同じ service
- クライアントが「これらをまとめて使う」なら同じ service
- 認証・デプロイ単位・チーム境界が違うなら service（＝ファイル）を分ける

---

## 2. 事前準備

### 2.1 ローカルインストール先の用意

> gRPC はシステム全体へ入れると他パッケージと衝突しやすい。
> **ユーザーディレクトリ配下へのローカルインストールが強く推奨される。**

```bash
export MY_INSTALL_DIR=$HOME/.local
mkdir -p $MY_INSTALL_DIR
export PATH="$MY_INSTALL_DIR/bin:$PATH"
```

`export` はそのシェルセッションのみ有効。恒久化するなら `~/.bashrc` に追記する。

### 2.2 cmake（3.16 以上）

```bash
# Linux
sudo apt install -y cmake
# macOS
brew install cmake
# Windows
choco install cmake

cmake --version
```

ディストリ標準の cmake が古い場合は公式スクリプトでローカルへ入れる。

```bash
wget -q -O cmake-linux.sh https://github.com/Kitware/CMake/releases/download/v3.30.3/cmake-3.30.3-linux-x86_64.sh
sh cmake-linux.sh -- --skip-license --prefix=$MY_INSTALL_DIR
rm cmake-linux.sh
```

### 2.3 ビルドツール

```bash
# Linux
sudo apt install -y build-essential autoconf libtool pkg-config
# macOS
brew install autoconf automake libtool pkg-config
```

---

## 3. gRPC のクローンとビルド

### 3.1 リポジトリのクローン

```bash
git clone --recurse-submodules -b v1.82.0 --depth 1 --shallow-submodules https://github.com/grpc/grpc
```

| フラグ | 意味 |
| --- | --- |
| `--recurse-submodules` | 依存サブモジュール（protobuf など）も取得 |
| `-b v1.82.0` | リリースタグを指定 |
| `--depth 1` | 履歴を 1 コミットだけ取得して軽量化 |
| `--shallow-submodules` | サブモジュールも浅くクローン |

### 3.2 gRPC と Protocol Buffers のビルド＆インストール

**Linux / macOS:**

```bash
cd grpc
mkdir -p cmake/build
pushd cmake/build
cmake -DgRPC_INSTALL=ON \
      -DgRPC_BUILD_TESTS=OFF \
      -DCMAKE_CXX_STANDARD=17 \
      -DCMAKE_INSTALL_PREFIX=$MY_INSTALL_DIR \
      ../..
make -j 4
make install
popd
```

**Windows:**

```bat
mkdir "cmake\build"
pushd "cmake\build"
cmake -DgRPC_INSTALL=ON -DgRPC_BUILD_TESTS=OFF -DCMAKE_CXX_STANDARD=17 -DCMAKE_INSTALL_PREFIX=%MY_INSTALL_DIR% ..\..
cmake --build . --config Release --target install -j 4
popd
```

| オプション | 意味 |
| --- | --- |
| `-DgRPC_INSTALL=ON` | `make install` を可能にする |
| `-DgRPC_BUILD_TESTS=OFF` | gRPC 自体のテストはビルドしない（時間短縮） |
| `-DCMAKE_CXX_STANDARD=17` | C++17 でビルド |
| `-DCMAKE_INSTALL_PREFIX` | ローカルインストール先 |
| `make -j 4` | 4 並列ビルド（マシンに合わせる。数分〜20 分程度） |

> `pushd` / `popd` はディレクトリ移動をスタックで管理する。`pushd` で入り、`popd` で戻る。

インストール後、`$MY_INSTALL_DIR` 配下に以下が入る。

- gRPC / protobuf のライブラリ・ヘッダ
- `protoc`（Protocol Buffers コンパイラ）
- `grpc_cpp_plugin`（protoc の gRPC C++ 用プラグイン）

---

## 4. サンプル（helloworld）のビルドと実行

### 4.1 ビルド

**Linux / macOS:**

```bash
cd examples/cpp/helloworld
mkdir -p cmake/build
pushd cmake/build
cmake -DCMAKE_PREFIX_PATH=$MY_INSTALL_DIR ../..
make -j 4
popd
```

**Windows:**

```bat
mkdir "cmake\build"
pushd "cmake\build"
cmake -DCMAKE_INSTALL_PREFIX=%MY_INSTALL_DIR% ..\..
cmake --build . --config Release -j 4
popd
```

`-DCMAKE_PREFIX_PATH=$MY_INSTALL_DIR` を渡すことで、
CMake の `find_package(gRPC)` がローカルインストールした gRPC を発見できる。

### 4.2 実行

```bash
# ターミナル 1
./greeter_server

# ターミナル 2
./greeter_client
```

出力:

```
Greeter received: Hello world
```

クライアントが `HelloRequest{ name: "world" }` を送り、
サーバーが `HelloReply{ message: "Hello world" }` を返している。

---

## 5. RPC メソッドを追加する（開発サイクルの体験）

「`.proto` 編集 → コード再生成 → サーバー/クライアント実装 → 再ビルド」という
gRPC 開発の基本サイクルを体験する。ここでは `SayHelloAgain` を追加する。

### 5.1 `.proto` を編集

`examples/protos/helloworld.proto`:

```protobuf
// あいさつサービスの定義
service Greeter {
  // あいさつを送る
  rpc SayHello (HelloRequest) returns (HelloReply) {}
  // もう一度あいさつを送る（今回追加）
  rpc SayHelloAgain (HelloRequest) returns (HelloReply) {}
}

// ユーザー名を含むリクエストメッセージ
message HelloRequest {
  string name = 1;
}

// あいさつ文を含むレスポンスメッセージ
message HelloReply {
  string message = 1;
}
```

`= 1` はフィールド番号。ワイヤーフォーマット上の識別子であり、
一度割り当てた番号は変更・再利用してはならない。

### 5.2 コードを再生成

helloworld の CMake 設定はビルド時に `protoc` + `grpc_cpp_plugin` を
自動実行するので、再ビルドするだけで生成コードが更新される。

```bash
# Linux / macOS
make -j 4
# Windows
cmake --build . --config Release -j 4
```

### 5.3 サーバーを実装

`greeter_server.cc` の `GreeterServiceImpl`:

```cpp
class GreeterServiceImpl final : public Greeter::Service {
  Status SayHello(ServerContext* context, const HelloRequest* request,
                  HelloReply* reply) override {
     // ...
  }

  Status SayHelloAgain(ServerContext* context, const HelloRequest* request,
                       HelloReply* reply) override {
    std::string prefix("Hello again ");
    reply->set_message(prefix + request->name());
    return Status::OK;
  }
};
```

- `request` … クライアントから届いたリクエスト（読み取り専用）
- `reply` … ここに書き込んだ内容がクライアントへ返る
- `return Status::OK;` … 正常終了。エラー時は `Status(StatusCode::..., "msg")` を返す

### 5.4 クライアントを実装

`GreeterClient` クラスにメソッドを追加する。
`stub_` は `.proto` から生成されたクライアントスタブ。

```cpp
std::string SayHelloAgain(const std::string& user) {
  HelloRequest request;
  request.set_name(user);
  HelloReply reply;
  ClientContext context;

  Status status = stub_->SayHelloAgain(&context, request, &reply);
  if (status.ok()) {
    return reply.message();
  } else {
    std::cout << status.error_code() << ": " << status.error_message()
              << std::endl;
    return "RPC failed";
  }
}
```

`main()`:

```cpp
int main(int argc, char** argv) {
  // ...
  std::string reply = greeter.SayHello(user);
  std::cout << "Greeter received: " << reply << std::endl;

  reply = greeter.SayHelloAgain(user);
  std::cout << "Greeter received: " << reply << std::endl;

  return 0;
}
```

### 5.5 再ビルドして実行

```bash
# Linux / macOS
make -j 4
# Windows
cmake --build . --config Release -j 4

./greeter_server
./greeter_client
```

出力:

```
Greeter received: Hello world
Greeter received: Hello again world
```

---

## 6. 本プロジェクトへの適用メモ

本プロジェクトでは C++/libtorch 側（ai-engine）を gRPC サーバー、
Rust バックエンド側をクライアントとして分離する
（`CLAUDE.md` の方針。gRPC 境界はデプロイ形態に関わらずコード上に維持）。

### 6.1 proto の配置

- proto ファイルは [apps/backend/proto/](../../../proto/) に集約（Rust / C++ 双方から参照）。
- C++ 側の生成物はビルドディレクトリに出力し、リポジトリにはコミットしない方針が扱いやすい。

### 6.2 CMake への組み込み方針

helloworld のサンプル CMake（`examples/cpp/helloworld/CMakeLists.txt`）が
`protoc` / `grpc_cpp_plugin` をカスタムコマンドで呼ぶ書き方の参考になる。
ai-engine 側の `CMakeLists.txt` に以下を組み込む想定:

1. `find_package(Protobuf CONFIG REQUIRED)` / `find_package(gRPC CONFIG REQUIRED)`
2. `add_custom_command` で `*.proto` → `*.pb.cc` / `*.grpc.pb.cc` を生成
3. 生成物を ai-engine のライブラリターゲットに追加
4. `gRPC::grpc++` / `protobuf::libprotobuf` をリンク

### 6.3 devcontainer での gRPC の入手

現状の devcontainer は `nvidia/cuda:12.6.2-cudnn-devel-ubuntu22.04` ベース。
gRPC の入れ方は次の 2 案がある。どちらを採るかは別途相談。

| 案 | メリット | デメリット |
| --- | --- | --- |
| ソースから `v1.82.0` をビルドしてイメージに焼く | バージョンを固定できる／公式手順どおり | イメージビルドが重い（`make -j` で10〜20 分） |
| `apt install libgrpc++-dev protobuf-compiler-grpc` | 導入が速い | Ubuntu 22.04 のパッケージは gRPC 1.30 系と古い |

CMake ビルドは `ccache` が効くよう devcontainer 側で設定済み
（`CMAKE_CXX_COMPILER_LAUNCHER=ccache`）。gRPC 本体のソースビルドにも `ccache` が効く。

### 6.4 ストリーミングの用途

学習ループの進捗（epoch / loss / metric）を Rust 側へ流すのは
**サーバーストリーミング RPC** が適する。詳細は公式の
「gRPC Basics: C++」チュートリアルを参照。

---

## 7. 次のステップ（公式ドキュメント）

- Introduction to gRPC … 概念的な入門
- gRPC Basics: C++ … 4 種類の RPC を扱う本格チュートリアル
- C++ API リファレンス

---

## 参考リンク

- gRPC C++ Quick start: <https://grpc.io/docs/languages/cpp/quickstart/>
- gRPC C++ examples: <https://github.com/grpc/grpc/tree/master/examples/cpp>
- Protocol Buffers (proto3) 言語ガイド: <https://protobuf.dev/programming-guides/proto3/>

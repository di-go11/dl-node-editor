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

## gRPCの基本文法

### syntax

```proto
syntax="proto3"
```
protobuffer言語仕様となるproto3リビジョンの定義となっている。これが定義されていない場合プロトコルバッファコンパイラは`proto2`を使用する。

#### edition

`syntax = "proto3"`と`syntax = "proto2"`の二択のバージョン指定を置き換えるもの。

proto2とproto3では仕様がかなり異なる(optionalの扱い、デフォルト値など)新機能を追加するたびに「proto4を作るか?」という問題が出ていた。これは利用者の大きな移行を必要としてしまうため、これを解決するために「構文バージョン」ではなく、「年でバージョニングされた機能セット」という考え方に変更した。

```proto
edition = "2023";

message SearchRequest {
  string query = 1;
}
```

これにより、proto2/proto3のようにすべてをそれぞれのprotoNにするのではなく、`features`という仕組みでフィールド単位、メッセージ単位、ファイル単位に挙動を指定できる。

```proto
edition = "2023";

message Foo {
  int32 bar = 1 [features.field_presence = IMPLICIT]; // proto3的挙動
  int32 baz = 2 [features.field_presence = EXPLICIT]; // proto2的挙動
}
```

### message

RPCで通信する際のデータ構造を定義する際に使用する。

```proto

message SearchRequest{
  string quety = 1;
  int32 page_number = 2;
  int32 result = 3;
}
```

- c++的考えだと、`message = struct`と考えればよくて、SearchRequestは構造体のエイリアスと考えれば良い。
- messageの内部で定義されている変数たちをc++同様 `フィールド`と呼称する。 `=1`,`=2`などがあるがこれは`フィールド番号`と呼ばれている。

#### フィールド番号の指定

メッセージ定義の各フィールドには、`1`から`536,870,911`までの番号を以下の制限つきで与える必要がある。

1. 指定された番号は、そのメッセージのすべてのフィールドの中で`一意でなければいけない`
2. フィールド番号`19,000`から`19,999`はProtocol Buffersの実装のために予約されている。
3. 以前に予約されたフィールド番号や拡張機能に割り当てられたフィールド番号は使用できない。

また、最も頻繁に指定されるフィールドには、フィールド番号`1`から`15`を使用する必要がある。これはフィールド番号がエンコードで1バイトにかかるため、ワイヤ形式でスペースが少なくて済むためである
#### フィールドの削除

(https://protobuf.dokyumento.jp/programming-guides/proto3/#deleting)[https://protobuf.dokyumento.jp/programming-guides/proto3/#deleting]参照
フィールドの削除は適切に行われないと深刻な問題を引き起こす可能性がある。

フィールドが不要になり、クライアントコードからすべての参照が削除された場合、メッセージからフィールド定義を削除できる。しかし、削除されたフィールド番号は`予約する`必要がある。`削除されてフィールド番号を予約しない場合`将来開発者がその番号を再利用する可能性があるため。

また、Rust側だけ再ビルドしても、C++側は古いままという状況(これ前提のフレームワークだからこそ単純に消してはいけない)=両方同時に再コンパイルすればいいじゃんという前提は持ってはいけない。

#### フィールド番号の予約

```proto
message Foo {
  reserved 2, 15, 9 to 11;
}
```

※ `9to11` = `9,10,11`と同義

#### フィールド名の予約

```proto
message Foo {
  reserved "foo", "bar";
}
```

#### フィールド型の指定

##### 1. スカラー型(基本の型)

```proto
message SearchRequest {
  string query = 1;
  int32  page_number = 2;
  int32  result_per_page = 3;
}
```
代表的なもの
|protobuf型|意味|デフォルト値|
|---|---|---|
|string|UTF-8文字列|空文字列|
|bool|true/false|false|
|int32/int64|符号あり整数|0|
|uint32/uinto64|符号なし整数|0|
|float/double|浮動小数点|0|
|bytes|任意のバイト列|空バイト列|
|enum||最初の要素(値のもの)|

##### 2. 他のmessage型

```proto
message Message1{
  Message0 foo = 1;
}
```

自分で定義した`message`も型として扱える。

##### 3. enum型

```proto
enum Corpus {
  UNIVERSAL = 0;
  WEB = 1;
  IMAGES = 2;
}

message SearchRequest {
  Corpus corpus = 4;
}
```
決まった選択肢を表す型
- 最初の要素の値は`必ず0`にする。(proto3の制約)
- 同じ数値の複数の名前を割り当てたい場合は`option allow_alias = true`
- enumにも`reserved`が使える。

##### 4. repeated/ mapなどの修飾

```proto
message SearchRequest {
  repeated string tags = 5;        // 配列（0個以上）
  map<string, int32> scores = 6;   // マップ
}
```
型そのものではなく、「フィールドの持ち方」の指定。

##### 5.optional

proto3では通常、フィールドに`optional`をつけなくても、宣言すればすでに「値をセットしなくてもいい」状態になる。ただしセットしなかった場合、`型ごとのデフォルト値`が入り、「明示的に0を入れたのか」「単に何もセットしなかったのか」を区別できない。

```proto
message SearchRequest {
  int32 page_number = 1;
}
```
page_number をセットしない → 0
page_number = 0 を明示的にセット → 0
どちらも同じ0になり、区別がつかない。 これが proto3 の「暗黙のプレゼンス（implicit presence）」。

`optional`をつけると

```proto
message Message1{
  optional int32 page_number;
}
```
これをつけると、「そのフィールドが明示的にセットされたかどうか」を区別できるようになる。生成コードでは`has_page_number()`のようなメソッドが扱えるようになる。

```proto
// C++ (生成コード) のイメージ
if (request.has_page_number()) {
  // 明示的にセットされていた
} else {
  // セットされていない（未指定）
}
```

**使うタイミング**

「0」「型文字列」「false」がデフォルト値でありつつ、それが「業務的に意味のある値」なのか「未入力」区別したいときに使う。
今回のcapabilities.protoの場合
```proto
message DeviceInfo{
  string device_type = 1;
  optional int32 device_index = 2; // GPUがない環境ではindex自体が「未指定」でありうる
}
```

- optional なし: device_index が 0 の時、「GPU 0番」なのか「そもそも未設定」なのか区別できない
- optional あり: has_device_index() で「そもそも指定されていない」ことを判定できる

※「値のセット」は各言語ごとでprotocが生成したコードのクラス/構造体に対して、setterメソッドを呼ぶ」ことで行う。

##### 6. oneof(複数フィールドから1つだけ選ばせる)

```proto
message Message1 {
  oneof test_oneof{
    string name = 4;
    int32 sub_message = 9;
  }
}
```

- optionalとは異なり、複数フィールドの排他制御(選択されなかったフィールドは使用されない)とすることができる。セットすると他の値は自動でクリアされる。

##### 7.import(他.protoファイルの参照)

`capabilities.proto`/`training.proto`/`common.proto`を分けている今のプロジェクト構成では特に必要な項目

```proto
import "common.proto"

message TrainingRequest {
  common.Device device = 1;
}
```

##### 8. Well-Known Type (よく使う標準message)

`google/protobuf`配下で提供されている汎用型.プロジェクトの`Empty`的な空messageの話の関連で紹介しておくと理解がつながる。

|型|用途|
|---|---|
|google.protobuf.Empty|引数/戻り値なしを表す空message|
|google.protobuf.Timestamp|日時|
|google.protobuf.Duration|時間間隔|
|google.protobuf.Any|型が動的に変わる値を埋め込む|

##### 9.スタイルガイド(命名規則)

チームで書く際に揺れやすいので一言あると良い。

- message名:`UpperCamelCase`(例:`SearchRequest`)
- フィールド名:`snake_case` (例:`page_number`)
- enum名:`UpperCamelCase`, enum値: `UPPER_SNAKE_CASE`
- service/rpc名: `UpperCamelCase`

### service

**関連するRPCメソッドをひとまとめにしたもの**。オブジェクト指向的考えでは、「インターフェース」Rustでは「トレント」

```proto
service Greeter{
  rpc SayHello (HelloRequest) returns (HelloReply) {}
  rpc SayHelloAgain (HelloRequest) returns (HelloReply) {}
}
```

これをコンパイルすると、言語ごとにいかが生成される。

|生成物|役割|
|---|---|
|サーバー側の基底クラス(例:Greeter::Service)|この仮想関数をoverrideして実装する|
|クライアント側のスタブ(例:Greeter::Stub)|メソッドを呼ぶだけでRPCが飛ぶ|

### rpc

`service`の中の**個々のメソッド定義**。

```proto
rpc メソッド名 (リクエスト型) returns (レスポンス型);
```

- 引数・戻り値は必ず`message`型でなければいけない(スカラー型を直接渡せない)
- リクエストが1つの値だけでも、監修として専用の`XxxRequest`messageでラップする(将来フィールドを増やせるように)

```proto
rpc SayHello (HelloRequest) returns (HelloReply){}
```

#### 4種類のrpc(stream キーワードの有無で決まる)

`stream`を付ける位置で意味が変わる。

```proto
service TrainingService{
  rpc StartTraining(StartTrainigRequest) returns (StartTrainingRespose); //単項
  rpc StreamProgress(StreamProgressRequest) returns (stream ProgressResponse); // サーバーストリーミング
  rpc UploadChunks(stream ChunkRequest) returns (UploadResponse); // クライアントストリーミング
  rpc Control(stream ControlMsg) returns (stream ControlMsg); //双方向ストリーミング
}
```

|位置|意味|
|---|---|
|リクエスト側にstream|クライアントが複数回送る|
|レスポンス側にstream|サーバーが複数回返す|
|両方にstream|双方向で自由にやり取り(コネクション張ったまま)|

#### 生成コードのイメージ(C++)

- **サーバー側**:基底クラスを継承し、仮想関数を実装する。

```proto
class GreeterServiceImpl final : public Greeter::Service {
  Status SayHello(ServerContext* context, const HelloRequest* Request, HelloReply* reply) override {reply->set_message("Hello" + request->name());
  return Status::OK;
  }
};
```

3つの引数がすべてポインタになっているのは
|引数|型|なぜポインタか|
|---|---|---|
|context|ServerContext*|メタデータ・キャンセル状態などを持つ、書き換え可能なオブジェクト|
|request|const HelloRequest*|クライアントから届いたでーた。**読み取り専用**なのでconstがつく|
|reply|HelloReply*|ここに書き込んだ内容がクライアントへ返る、**出力用パラメータ**|

- c++では「関数の外にあるオブジェクトへの参照渡し」に、ポインタが参照(`&`)を使う。
- `request`、`reply`はgRPCランタイム側が確保したオブジェクトの実体を指していて、この関数はその所有権を持たいない(コピーもnewもしない、ただ中身を読む/書くだけ)ことをポインタで表現している。
- `reply`がポインタである理由は特に重要で、**戻り値として返す代わりに、引数経由で結果を書き込む**というOut-Parameterパターン. `reply->ser_message()`のように呼び出し元が用意したオブジェクトを直接書き換える=セッター

`->`はポインタが指す先のメンバにアクセスする演算子

- `Status::OK`
`Status`はgRPCが提供する型で、「RPC」の成否・エラー内容を表す。`OK`はその中の**静的メンバ変数**。
```proto
return Status::OK
```
- `Status`クラス自身に、あらかじめ「成功」を表す定数インスタンスが用意されている
- `::`Statusクラスが持つOKという静的メンバを意味するため
- エラーを返したい場合`return Status(grpc::StatusCode::INVALID_ARGUMENT, "name is empty");

- **クライアント側**:スタブのメソッドを呼ぶだけ

```proto
Status status = stub_->SayHello(&context, request, &reply);
```

サーバーストリーミングの場合は`ServerWriter`、クライアントストリーミングは`ServerReader`、双方向は`ServerReaderWriter`を使うことになる。

#### serviceを分ける/まとめる基準

- 同じリソース(学習job等)を扱う操作は同じ`service`
- ドメインが変われば`.proto`ファイルごと分ける(`capabilities.proto`/`training.proto`/`inference.proto`)

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

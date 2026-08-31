# LibTorch 仕様書

このプロジェクト(ai-engine)で使用している **LibTorch**(PyTorch の C++ フロントエンド)の
バージョン・ヘッダ構成・名前空間・主要 API を体系的にまとめたリファレンス。
`torch::nn::functional` とモデルの保存/読み込み(`torch::save`)は特に詳述する。

---

## 1. バージョン・導入方法

| 項目 | 内容 |
|---|---|
| バージョン | **2.13.0**(`2.13.0+cu126`) |
| ビルド種別 | CUDA 12.6 ビルド / **cxx11 ABI**(`libtorch-shared-with-deps-2.13.0+cu126`) |
| 導入元 | [download.pytorch.org](https://download.pytorch.org/libtorch/cu126/) から zip をダウンロードして `/opt/libtorch` へ展開 |
| インストール場所 | [.devcontainer/Dockerfile](../../../.devcontainer/Dockerfile) |
| ディレクトリ構成 | `/opt/libtorch/{include, lib, share, build-version, build-hash}` |
| CMake での検出 | `find_package(Torch REQUIRED)`([CMakeLists.txt](../CMakeLists.txt))。`CMAKE_PREFIX_PATH=/opt/libtorch` を経由 |
| リンク | `target_link_libraries(ai_engine_lib PRIVATE "${TORCH_LIBRARIES}")` |
| インクルードパス | `${TORCH_INCLUDE_DIRS}` を `target_include_directories` に追加 |
| 主 include | `#include <torch/torch.h>` |
| 必須コンパイルフラグ | `find_package(Torch)` が `${TORCH_CXX_FLAGS}`(cxx11 ABI 指定など)を提供。C++17 以上必須 |

### 1-1. CUDA オプションライブラリの遅延リンク

CUDA ビルドの `libtorch_cuda.so` は、構造化スパース演算(cuSPARSELt)やマルチ GPU 共有メモリ(NVSHMEM)用の
オプションライブラリを要求する。この環境ではそれらを使わないため、
[CMakeLists.txt](../CMakeLists.txt) で `target_link_options(... "-Wl,--allow-shlib-undefined")` を付け、
未使用シンボルの解決をリンク時ではなく実行時まで遅延させている(実行時にも参照されないため安全)。

---

## 2. LibTorch とは何か —— ライブラリの全体像

**LibTorch** は PyTorch の中核を C++ から使えるようにしたもの。Python の `torch` パッケージと
ほぼ同じ機能を、Python インタプリタなしで利用できる。層構造は下から:

| 層 | 名前空間 | 役割 | 代表ヘッダ |
|---|---|---|---|
| **c10**(Core Library) | `c10::` | 最下層の基盤型。`ScalarType`(dtype)・`Device`・`IValue`・`ArrayRef`・`optional`・例外 | `<c10/...>` |
| **ATen**(A Tensor library) | `at::` | テンソル本体と数千の演算子(`at::add`, `at::conv2d`, `at::matmul` …)。自動微分を**含まない**純粋な数値計算層 | `<ATen/ATen.h>` |
| **autograd** | `torch::autograd::` | ATen 演算子を record して逆伝播グラフを構築する。`Tensor::backward()` の実体 | `<torch/autograd.h>` |
| **C++ フロントエンド** | `torch::` | Python の `torch.nn` / `torch.optim` / `torch.utils.data` に対応する高レベル API。`torch::nn::Module`, `torch::optim`, `torch::data`, シリアライズ | `<torch/torch.h>` |
| **TorchScript / JIT** | `torch::jit::` | Python で `torch.jit.script`/`trace` して保存したモデルを C++ でロード・実行する | `<torch/script.h>` |

### 2-1. `at::Tensor` と `torch::Tensor` の関係

**同一の型**。`torch::Tensor` は `at::Tensor` の型エイリアス(`using`)。
本プロジェクトのコードで `at::Tensor` と `torch::Tensor` が混在しているのはそのため
(どちらでもよいが、統一するなら `torch::Tensor` 推奨)。同様に:

| よく使うエイリアス | 実体 |
|---|---|
| `torch::Tensor` | `at::Tensor` |
| `torch::Scalar` | `c10::Scalar` |
| `torch::Device` | `c10::Device` |
| `torch::ScalarType`, `torch::kFloat32` 等 | `c10::ScalarType`, `c10::kFloat32` |
| `torch::IValue` | `c10::IValue` |
| `torch::optional<T>`, `torch::nullopt` | `c10::optional<T>`(C++17 なら実質 `std::optional`) |
| `torch::ArrayRef<T>`, `torch::IntArrayRef` | `c10::ArrayRef<T>` |

---

## 3. ヘッダ構成と include の方法

### 3-1. アンブレラヘッダ(推奨)

```cpp
#include <torch/torch.h>   // C++ フロントエンド全部(nn / optim / data / autograd / serialize / Tensor)
```

`torch/torch.h` は「学習・推論を C++ で**書く**ために必要なものすべて」を含む。
本プロジェクトの [main.cpp](../main.cpp) や各 `infrastructure/torchFunc/*.cpp` はこれを使っている。
**TorchScript のロードは含まれない**(§10-6)。

```cpp
#include <torch/script.h>  // torch::jit::load など。Python で保存した .pt モデルを読む場合
```

### 3-2. 細粒度ヘッダ(コンパイル時間を切り詰めたい場合)

`torch/torch.h` は巨大で、include するだけでコンパイルが数秒重くなる。
**ヘッダファイル側**では必要な部分だけを取り込むと速い。本プロジェクトの
[TorchConv2DLayer.hpp](../src/training/infrastructure/torchFunc/TorchConv2DLayer.hpp) などが実践している:

```cpp
#include <torch/nn/modules/conv.h>       // torch::nn::Conv2d だけ
#include <torch/nn/modules/linear.h>     // torch::nn::Linear だけ
#include <torch/nn/modules/batchnorm.h>  // torch::nn::BatchNorm2d だけ
#include <torch/nn/modules/pooling.h>    // torch::nn::MaxPool2d / AvgPool2d
```

| 目的 | 細粒度ヘッダ |
|---|---|
| Tensor と ATen 演算のみ | `<ATen/ATen.h>` / `<torch/types.h>` |
| nn モジュール全部 | `<torch/nn.h>` |
| nn::functional | `<torch/nn/functional.h>` |
| optimizer | `<torch/optim.h>`(個別は `<torch/optim/adam.h>` 等) |
| シリアライズ | `<torch/serialize.h>` |
| データローダ | `<torch/data.h>` |
| autograd | `<torch/autograd.h>` |
| デバイス/CUDA 問い合わせ | `<torch/cuda.h>` |

方針:**`.cpp` では `<torch/torch.h>`、公開ヘッダ `.hpp` では細粒度ヘッダ**、という使い分けが
コンパイル時間と実装の隠蔽の両面で有利。

### 3-3. 名前空間のエイリアス

`torch::nn::functional` は毎回書くと長いため、慣習的に `.cpp` のローカルで別名を付ける
([CrossEntropy.cpp](../src/training/infrastructure/torchFunc/CrossEntropy.cpp) で実践):

```cpp
namespace F = torch::nn::functional;   // 関数スコープ or 無名名前空間で。ヘッダには書かない
```

`torch::indexing`(スライス記法用)も同様に `using namespace torch::indexing;` をローカルで使う。

---

## 4. Tensor —— テンソル(`at::Tensor` / `torch::Tensor`)

### 4-1. 概念

**テンソル**は多次元配列。スカラー(0階)・ベクトル(1階)・行列(2階)・それ以上(N階)を統一的に扱う型。
LibTorch の `Tensor` は以下をカプセル化する:

- **データ**(連続 or ストライド付きのメモリブロック。`shared_ptr` 的に参照カウントで共有)
- **形状(shape / sizes)** と **ストライド(strides)**
- **dtype**(`kFloat32`, `kInt64`, `kUInt8`, `kBool` …)
- **device**(`kCPU`, `kCUDA:0` …)
- **`requires_grad`** フラグと **autograd グラフへのリンク**(`grad_fn`)

Tensor はハンドル(参照カウント式のスマートポインタに近い)。コピーは**浅い**(同じデータを指す)。
実データを複製したいときは `.clone()`。

### 4-2. 生成

```cpp
torch::Tensor a = torch::zeros({2, 3});                       // 2x3 のゼロ
torch::Tensor b = torch::ones({3}, torch::kInt64);            // int64 の [1,1,1]
torch::Tensor c = torch::full({2, 2}, 7.0);
torch::Tensor d = torch::eye(3);                              // 単位行列
torch::Tensor e = torch::arange(0, 10);                       // [0,1,...,9]
torch::Tensor f = torch::linspace(0, 1, 5);
torch::Tensor g = torch::rand({2, 2});                        // 一様乱数 [0,1)
torch::Tensor h = torch::randn({2, 2});                       // 標準正規乱数
torch::Tensor i = torch::empty({4, 4});                       // 未初期化(高速)

// C++ の std::vector から
std::vector<float> raw = {1, 2, 3, 4};
torch::Tensor t = torch::tensor(raw, torch::TensorOptions().dtype(torch::kFloat32))
                      .reshape({2, 2});

// 既存メモリを「借りる」(コピーなし。所有権は呼び出し側。危険なので寿命に注意)
torch::Tensor v = torch::from_blob(ptr, {H, W, 3}, torch::kUInt8);
```

本プロジェクトの [BatchTensorConverter.hpp](../src/training/adapters/impl/BatchTensorConverter.hpp) は
`torch::tensor(flattened, ...).reshape({N,C,H,W})` で `std::vector<float>` からバッチテンソルを作っている。

### 4-3. `TensorOptions` —— 生成時のメタ指定

dtype・device・レイアウト・`requires_grad` を**メソッドチェーンで**組み立てるビルダー。

```cpp
auto opts = torch::TensorOptions()
                .dtype(torch::kFloat32)
                .device(torch::kCUDA, 0)
                .requires_grad(true);
torch::Tensor w = torch::randn({64, 3, 3, 3}, opts);
```

多くの生成関数は `TensorOptions` を最後の引数に取る。単一項目だけなら `torch::zeros({2}, torch::kInt64)` のように
`ScalarType` や `Device` を直接渡してもよい(暗黙に `TensorOptions` へ変換される)。

### 4-4. 形状・dtype・device の操作

| 操作 | 例 | 備考 |
|---|---|---|
| 形状取得 | `t.sizes()`, `t.size(0)`, `t.dim()`, `t.numel()` | `sizes()` は `IntArrayRef` |
| 変形(コピーなし) | `t.view({N, -1})` | 連続メモリ必須。`-1` は自動計算 |
| 変形(必要ならコピー) | `t.reshape({N, -1})` | 非連続でも可 |
| 次元追加/削除 | `t.unsqueeze(1)`, `t.squeeze(1)` | サイズ 1 の次元を挿入/除去 |
| 転置・並べ替え | `t.transpose(1, 2)`, `t.permute({0, 3, 1, 2})` | HWC→CHW など |
| 連続化 | `t.contiguous()` | `permute` 後に `view` したいとき |
| dtype 変換 | `t.to(torch::kInt64)`, `t.to(torch::kFloat32)` | |
| device 転送 | `t.to(torch::kCUDA)`, `t.to(device)`, `t.cpu()`, `t.cuda()` | |
| 一括変換 | `t.to(device, torch::kFloat32)` | |

本プロジェクトの `BatchTensorConverter::convertTarget` は
`t.squeeze(1).to(torch::kInt64)` で `[N,1,H,W] float` → `[N,H,W] long`(クラス ID)に変換している。

### 4-5. 主な演算子

| カテゴリ | API 例 |
|---|---|
| 要素ごとの算術 | `a + b`, `a * b`, `torch::add(a, b)`, `a.add_(b)`(末尾 `_` は in-place) |
| 行列積 | `torch::matmul(a, b)`, `a.mm(b)`, `torch::einsum("ij,jk->ik", {a, b})` |
| 縮約 | `t.sum()`, `t.mean(/*dim=*/1)`, `t.max()`, `t.argmax(1)`, `t.norm()` |
| 比較・論理 | `a > b`, `torch::eq(a, b)`, `t.all()`, `t.any()` |
| 連結・分割 | `torch::cat({a, b}, /*dim=*/0)`, `torch::stack({a, b})`, `t.chunk(4, 1)`, `t.split(16, 0)` |
| インデックス | `t.index({Slice(), 0})`, `t.index_select(0, idx)`, `t.masked_select(mask)`, `t.gather(1, idx)` |
| 数学関数 | `torch::exp`, `torch::log`, `torch::sqrt`, `torch::clamp(t, 0, 1)`, `torch::softmax(t, dim)` |
| 生成系 | `torch::zeros_like(t)`, `torch::ones_like(t)` |

**in-place 演算(末尾 `_`)** は `requires_grad` なテンソルに対して使うと autograd グラフを壊すことがあるため、
学習中は原則コピー版(`a = a + b`)を使う。

### 4-6. C++ 値との相互変換

```cpp
float x = t.item<float>();        // 0階テンソル → C++ スカラー
int64_t n = t.item<int64_t>();
auto acc = t.accessor<float, 2>();      // CPU テンソルへの型付き高速アクセス acc[i][j]
float *p = t.data_ptr<float>();          // 生ポインタ(連続・CPU 前提)
```

---

## 5. 自動微分(autograd)

### 5-1. 原理

`requires_grad=true` のテンソルを起点に演算を行うと、LibTorch は演算の履歴を
**有向非巡回グラフ(DAG)** として記録する(各テンソルの `grad_fn` が親演算を指す)。
スカラー損失 `L` に対して `L.backward()` を呼ぶと、連鎖律に従ってグラフを逆向きにたどり、
各葉テンソル(パラメータ)の `.grad` に ∂L/∂param を**加算**する。

### 5-2. 基本 API

```cpp
torch::Tensor w = torch::randn({3, 3}, torch::requires_grad());
torch::Tensor x = torch::randn({3});
torch::Tensor y = (w.mv(x)).sum();   // スカラー

y.backward();                         // 逆伝播。w.grad() に勾配が入る
std::cout << w.grad() << std::endl;

w.grad().zero_();                     // 勾配は加算されるので、次のステップ前にゼロクリア必須
```

| API | 意味 |
|---|---|
| `torch::requires_grad()` / `.requires_grad_(true)` | 勾配追跡を有効化 |
| `t.backward()` | 逆伝播(`t` は普通スカラー。非スカラーなら `t.backward(grad_output)`) |
| `t.grad()` | 蓄積された勾配テンソル |
| `t.detach()` | グラフから切り離したビュー(勾配が流れない) |
| `torch::NoGradGuard g;` | このスコープ内は勾配追跡を停止(推論・パラメータ更新時) |
| `torch::InferenceMode g;` | `NoGradGuard` より強い最適化。純粋な推論専用 |
| `t.retain_grad()` | 中間テンソルの勾配も保持 |

### 5-3. 本プロジェクトの学習ループ

[TorchModel.cpp](../src/training/infrastructure/torchModel/TorchModel.cpp) の `train()`:

```cpp
optimizer.resetGradients();   // = optim->zero_grad()。前ステップの勾配を消す
lossValue.backward();          // 逆伝播でパラメータの .grad を埋める
optimizer.updateParmeters();   // = optim->step()。.grad を使ってパラメータ更新
```

この「ゼロクリア → forward/loss → backward → step」が学習の 1 イテレーション。

---

## 6. `torch::nn` —— ニューラルネットワークモジュール

### 6-1. Module システムと Holder パターン

`torch::nn::Module` はパラメータ・バッファ・サブモジュールを保持し、
`parameters()` / `named_parameters()` / `to(device)` / `train()` / `eval()` / `save`/`load` を提供する基底クラス。

C++ 版では **モジュールは 2 つの型がペアで存在**する:

| 型 | 例 | 実体 |
|---|---|---|
| 実装クラス | `torch::nn::Conv2dImpl` | `torch::nn::Module` を継承した本体 |
| **Holder(ラッパー)** | `torch::nn::Conv2d` | `std::shared_ptr<Conv2dImpl>` を包んだ `ModuleHolder`。**通常はこちらを使う** |

Holder は `->` で実装にアクセスする(スマートポインタと同じ操作感):

```cpp
torch::nn::Conv2d conv(torch::nn::Conv2dOptions(3, 16, 3));
torch::Tensor y = conv->forward(x);          // -> でアクセス
std::vector<torch::Tensor> p = conv->parameters();
```

自作モジュールを定義するときは `TORCH_MODULE(Name)` マクロで Holder を生成する。

### 6-2. Options イディオム

各モジュールのコンストラクタ引数は `〇〇Options` 構造体にまとめ、**必須引数はコンストラクタ、
省略可能引数はメソッドチェーン**で与える。本プロジェクトの各レイヤーラッパーが全面的に使っている。

```cpp
// TorchConv2DLayer.cpp
_module(torch::nn::Conv2dOptions(params.inChannels, params.outChannels, params.kernelSize)
            .stride(params.stride)
            .padding(params.padding))

// TorchBatchNormLayer.cpp
torch::nn::BatchNormOptions(params.numFeatures).eps(params.eps).momentum(params.momentum)

// TorchLinearLayer.cpp
torch::nn::LinearOptions(params.inFeatures, params.outFeatures).bias(params.bias)
```

### 6-3. 主要モジュール一覧

| 分類 | モジュール(Holder 名) | Options |
|---|---|---|
| 全結合 | `Linear`, `Bilinear` | `LinearOptions(in, out).bias(bool)` |
| 畳み込み | `Conv1d` / `Conv2d` / `Conv3d`, `ConvTranspose2d` | `Conv2dOptions(inC, outC, kernel).stride().padding().dilation().groups().bias()` |
| プーリング | `MaxPool2d`, `AvgPool2d`, `AdaptiveAvgPool2d`, `AdaptiveMaxPool2d` | `MaxPool2dOptions(kernel).stride().padding()` |
| 正規化 | `BatchNorm1d/2d/3d`, `GroupNorm`, `LayerNorm`, `InstanceNorm2d` | `BatchNormOptions(numFeatures).eps().momentum().affine().track_running_stats()` |
| 活性化 | `ReLU`, `LeakyReLU`, `ELU`, `GELU`, `Sigmoid`, `Tanh`, `Softmax`, `Hardswish` | 多くは Options 不要 / `SoftmaxOptions(dim)` |
| 正則化 | `Dropout`, `Dropout2d`, `AlphaDropout` | `DropoutOptions(p)` |
| 再帰 | `RNN`, `LSTM`, `GRU` | `LSTMOptions(input, hidden).num_layers().bidirectional().dropout()` |
| Transformer | `Transformer`, `TransformerEncoderLayer`, `MultiheadAttention` | `TransformerEncoderLayerOptions(dModel, nhead)` |
| 埋め込み | `Embedding`, `EmbeddingBag` | `EmbeddingOptions(num, dim)` |
| コンテナ | `Sequential`, `ModuleList`, `ModuleDict`, `AnyModule` | 複数モジュールをまとめる |
| 損失(モジュール版) | `CrossEntropyLoss`, `MSELoss`, `L1Loss`, `BCEWithLogitsLoss`, `NLLLoss`, `SmoothL1Loss` | `CrossEntropyLossOptions().ignore_index().reduction()` |
| アップサンプル | `Upsample` | `UpsampleOptions().size().scale_factor().mode()` |
| パディング | `ReflectionPad2d`, `ZeroPad2d`, `ConstantPad2d` | |
| フラット化 | `Flatten`, `Unflatten` | |

### 6-4. Sequential でモデルを組む例

```cpp
torch::nn::Sequential net(
    torch::nn::Conv2d(torch::nn::Conv2dOptions(3, 16, 3).padding(1)),
    torch::nn::ReLU(),
    torch::nn::MaxPool2d(2),
    torch::nn::Flatten(),
    torch::nn::Linear(16 * 16 * 16, 10));

torch::Tensor logits = net->forward(x);
```

### 6-5. モジュールの状態管理

| API | 意味 |
|---|---|
| `module->parameters()` / `named_parameters()` | 学習対象テンソル一覧(optimizer に渡す) |
| `module->buffers()` / `named_buffers()` | BatchNorm の running_mean など、勾配なしの永続状態 |
| `module->to(device)` / `module->to(torch::kFloat64)` | 全パラメータ・バッファを一括転送/変換 |
| `module->train()` / `module->eval()` | 学習モード / 評価モード切替(Dropout・BatchNorm の挙動が変わる) |
| `module->zero_grad()` | 全パラメータの `.grad` をクリア |
| `module->register_module(name, submodule)` | 自作モジュールでサブモジュールを登録 |
| `module->register_parameter(name, tensor)` | 生パラメータを登録 |

### 6-6. 本プロジェクトでの `torch::nn` の扱い

[ILayer](../src/training/adapters/interfaces/ILayer.hpp) という自前インターフェースで `torch::nn` を抽象化し、
具象ラッパー([TorchConv2DLayer](../src/training/infrastructure/torchFunc/TorchConv2DLayer.cpp) 等)が
`torch::nn::Conv2d` などをメンバに持つ。`ILayer::forward(input, output)` の中で `_module->forward(input)` を呼ぶ。

[TorchPoolingLayer](../src/training/infrastructure/torchFunc/TorchPoolingLayer.cpp) は
`std::variant<torch::nn::MaxPool2d, torch::nn::AvgPool2d>` で 2 種のプーリングを保持し、
`std::visit` でディスパッチしている(Holder が値型なので variant に入れられる)。

---

## 7. `torch::nn::functional` —— 関数版 API(要詳述)

### 7-1. モジュール版との違い

同じ演算が **2 つの形**で提供される。

| | モジュール版 `torch::nn::X` | 関数版 `torch::nn::functional::x` / `F::x` |
|---|---|---|
| 性質 | **状態を持つオブジェクト**。パラメータ(重み)を内部に保有し `parameters()` で公開 | **純粋関数**。状態なし。重みは引数で渡す |
| 生成 | `torch::nn::Linear fc(10, 3);` | 生成不要。`F::linear(x, weight, bias)` |
| 用途 | 学習対象の層(Conv/Linear/BatchNorm 等) | 重みのない演算(活性化・プーリング・損失・正規化の適用)、または重みを自前管理する場合 |
| autograd | 効く | 効く(同じ ATen 演算に落ちる) |

**判断基準**:その演算が**学習可能な重みを持つか**。持つなら基本モジュール版、持たない(ReLU, softmax, cross_entropy, max_pool2d, dropout, interpolate …)なら関数版が簡潔。

### 7-2. include とエイリアス

```cpp
#include <torch/nn/functional.h>          // または <torch/torch.h>
namespace F = torch::nn::functional;      // 慣習的な別名(.cpp のローカルで)
```

### 7-3. FuncOptions

関数版のオプションは `〇〇FuncOptions`(モジュール版の `〇〇Options` とは別の型)。

```cpp
// CrossEntropy.cpp(本プロジェクト)
output = F::cross_entropy(
    predicted, target,
    F::CrossEntropyFuncOptions().ignore_index(255));
```

`ignore_index(255)` は「ラベル 255 の画素は損失計算から除外」の意。
セグメンテーションで letterbox パディング部を無視するために使っている。

### 7-4. 主な関数一覧

| 分類 | 関数(`F::`) | 対応する `FuncOptions` |
|---|---|---|
| 活性化 | `relu`, `leaky_relu`, `elu`, `gelu`, `sigmoid`, `tanh`, `softmax`, `log_softmax`, `silu`, `hardswish` | `SoftmaxFuncOptions(dim)`, `LeakyReLUFuncOptions().negative_slope()` |
| 損失 | `cross_entropy`, `nll_loss`, `mse_loss`, `l1_loss`, `binary_cross_entropy`, `binary_cross_entropy_with_logits`, `smooth_l1_loss`, `kl_div` | `CrossEntropyFuncOptions().weight().ignore_index().reduction()` |
| プーリング | `max_pool2d`, `avg_pool2d`, `adaptive_avg_pool2d`, `max_pool2d_with_indices` | `MaxPool2dFuncOptions(kernel).stride().padding()` |
| 畳み込み(重み引数) | `conv2d`, `conv_transpose2d` | `Conv2dFuncOptions().stride().padding()` |
| 線形(重み引数) | `linear`, `bilinear` | — |
| 正規化 | `batch_norm`, `layer_norm`, `group_norm`, `normalize`, `local_response_norm` | `BatchNormFuncOptions().momentum().eps().training()` |
| ドロップアウト | `dropout`, `dropout2d`, `alpha_dropout` | `DropoutFuncOptions().p().training()` |
| パディング | `pad` | `PadFuncOptions({l, r, t, b}).mode(torch::kReflect).value()` |
| リサイズ | `interpolate` | `InterpolateFuncOptions().size().scale_factor().mode(torch::kBilinear).align_corners()` |
| 距離・類似度 | `cosine_similarity`, `pairwise_distance` | |
| グリッドサンプル | `grid_sample`, `affine_grid` | データ拡張・STN で使用 |
|埋め込み | `embedding`, `one_hot` | |

### 7-5. reduction オプション

損失関数の `reduction` は結果の集約方法。`torch::kMean`(既定)/ `torch::kSum` / `torch::kNone`(要素ごと)。

```cpp
F::mse_loss(pred, target, F::MSELossFuncOptions().reduction(torch::kSum));
```

### 7-6. トップレベル関数(`torch::` 直下)との関係

`torch::softmax(x, dim)` / `torch::relu(x)` / `torch::conv2d(...)` のように、
`torch::` 直下にも同じ演算がある(ATen 由来)。`F::` 版はこれらに `FuncOptions` インターフェースを
被せたもので、中身は同じ。本プロジェクトの [Softmax.cpp](../src/training/infrastructure/torchFunc/Softmax.cpp) は
`torch::softmax(input, _dim)` を直接使い、[CrossEntropy.cpp](../src/training/infrastructure/torchFunc/CrossEntropy.cpp) は
`F::cross_entropy(...)` を使っている(`ignore_index` を明示したいので Options 版が便利)。

---

## 8. `torch::optim` —— 最適化アルゴリズム

### 8-1. 基本形

```cpp
#include <torch/optim.h>   // 個別なら <torch/optim/adam.h>

std::vector<torch::Tensor> params = model->parameters();
torch::optim::Adam optim(params, torch::optim::AdamOptions(1e-3));

// 学習ループ内
optim.zero_grad();
loss.backward();
optim.step();
```

### 8-2. 提供される optimizer と Options

| Optimizer | Options とチェーンメソッド |
|---|---|
| `SGD` | `SGDOptions(lr).momentum().dampening().weight_decay().nesterov()` |
| `Adam` | `AdamOptions(lr).betas({b1, b2}).eps().weight_decay().amsgrad()` |
| `AdamW` | `AdamWOptions(lr).betas({b1, b2}).eps().weight_decay()` |
| `RMSprop` | `RMSpropOptions(lr).alpha().eps().weight_decay().momentum().centered()` |
| `Adagrad` | `AdagradOptions(lr).lr_decay().weight_decay()` |
| `LBFGS` | `LBFGSOptions(lr).max_iter().history_size()`(`step` にクロージャを渡す特殊形) |

本プロジェクトの [AdamOptimizer.cpp](../src/training/infrastructure/torchFunc/AdamOptimizer.cpp) 等:

```cpp
_optim = std::make_unique<torch::optim::Adam>(
    parameters,
    torch::optim::AdamOptions(learningRate)
        .betas(std::make_pair(beta1, beta2))
        .eps(eps)
        .weight_decay(weight_decay));
```

`std::unique_ptr` で持つ理由がヘッダのコメントに書かれている:
**前方宣言した `torch::optim::Adam` は不完全型なので値メンバにできない(サイズ不明)。
ポインタなら不完全型でも宣言でき、`.cpp` で完全型を見てから `make_unique` する**(pImpl と同じ理屈。
c++技術書.md「スマートポインタ」§9 参照)。

### 8-3. 学習率スケジューラ

```cpp
#include <torch/optim/schedulers/step_lr.h>
torch::optim::StepLR scheduler(optim, /*step_size=*/30, /*gamma=*/0.1);
// エポック終わりに
scheduler.step();
```

`StepLR` / `LambdaLR` / `MultiStepLR` / `ReduceLROnPlateau`(C++ 版は一部のみ提供)。

### 8-4. optimizer の状態保存

Adam のモーメント推定値などの内部状態も保存対象(§10-4)。

```cpp
torch::save(optim, "optim.pt");
torch::load(optim, "optim.pt");
```

### 8-5. 本プロジェクトでの抽象化

[IOptimizer](../src/training/adapters/interfaces/IOptimizer.hpp) が `resetGradients()` / `updateParmeters()` の
2 メソッドだけを公開し、`torch::optim` を infrastructure 層に隠している。
具象は `AdamOptimizer` / `AdamWOptimizer` / `SGDOptimizer` の 3 種。

---

## 9. 損失関数

| 形 | 使い方 |
|---|---|
| モジュール版 | `torch::nn::CrossEntropyLoss criterion(...); auto l = criterion->forward(logits, target);` |
| 関数版 | `F::cross_entropy(logits, target, F::CrossEntropyFuncOptions().ignore_index(255))` |
| ATen 直接 | `torch::nll_loss(torch::log_softmax(logits, 1), target)` |

主な損失:`cross_entropy`(多クラス分類。内部で `log_softmax` + `nll_loss`)、
`binary_cross_entropy_with_logits`(2 値・マルチラベル)、`mse_loss` / `l1_loss` / `smooth_l1_loss`(回帰)、
`kl_div`(分布間)、`ctc_loss`(系列)。

本プロジェクトは [ILoss](../src/training/adapters/interfaces/ILoss.hpp) で抽象化し、
`CrossEntropy` と `MseLoss` の 2 具象を持つ。
**セグメンテーションでは `predicted` は生ロジット `[N,C,H,W]`、`target` はクラス ID `[N,H,W]`(int64)** を渡す規約。
`cross_entropy` が内部で `log_softmax` するため、モデル最終層に活性化を置かない。

---

## 10. 保存と読み込み(要詳述)

### 10-1. LibTorch のシリアライズ形式

`torch::save` / `torch::load` が読み書きするのは **PyTorch 独自の zip アーカイブ**(拡張子は慣習的に `.pt`)。
内部に `data.pkl`(構造情報)とテンソルの生データが入る。C++ で保存したものは C++ で、
Python `torch.save` で保存したものは Python `torch.load` で読むのが基本。**C++⇔Python の相互運用は限定的**(§10-6)。

### 10-2. テンソル / テンソル列の保存

```cpp
#include <torch/serialize.h>   // <torch/torch.h> に含まれる

torch::Tensor w = torch::randn({3, 3});
torch::save(w, "w.pt");

torch::Tensor loaded;
torch::load(loaded, "w.pt");

// テンソルの vector もそのまま
std::vector<torch::Tensor> params = model->parameters();
torch::save(params, "params.pt");

std::vector<torch::Tensor> restored;
torch::load(restored, "params.pt");
```

### 10-3. モジュールの保存 / 読み込み

引数に **Holder** か `std::shared_ptr<Module>` を渡すと、`named_parameters()` と `named_buffers()` を
名前付きで直列化する(Python の `state_dict` に相当)。

```cpp
torch::nn::Sequential net( /* ... */ );

torch::save(net, "model.pt");     // パラメータ + バッファを保存
torch::load(net, "model.pt");     // 同じ構造の net に流し込む
```

**重要**:`torch::load(module, ...)` は**モデル構造を復元しない**。
ロード先に**同一構造のモジュールを先に構築**しておき、そこへ重みを流し込む。
構造(層の種類・順序・チャンネル数)はコード側(またはグラフ定義)で持つ責務。

### 10-4. Archive による細かい制御

`torch::save`/`torch::load` の内部で使われる低レベル API。複数オブジェクトを 1 ファイルに、
キー付きで書きたい場合に使う。

```cpp
#include <torch/serialize.h>

// 書き込み
torch::serialize::OutputArchive archive;
archive.write("epoch", torch::tensor(currentEpoch));
archive.write("model", modelArchive);          // ネストも可
model->save(archive);                          // Module::save(OutputArchive&)
optim.save(archive);
archive.save_to("checkpoint.pt");

// 読み込み
torch::serialize::InputArchive in;
in.load_from("checkpoint.pt");
torch::Tensor epochT;
in.read("epoch", epochT);
model->load(in);
optim.load(in);
```

### 10-5. optimizer の保存

チェックポイントから学習を再開するには、モデルだけでなく optimizer の内部状態
(Adam の 1 次・2 次モーメント、ステップ数)も保存する。

```cpp
torch::save(model, "model.pt");
torch::save(optim, "optim.pt");
// 再開時
torch::load(model, "model.pt");
torch::load(optim, "optim.pt");
```

### 10-6. Python との相互運用

| 目的 | 方法 |
|---|---|
| Python 学習済みモデルを C++ 推論 | Python で `torch.jit.script(model)` または `torch.jit.trace(model, example)` → `scripted.save("m.pt")`。C++ で `#include <torch/script.h>` → `torch::jit::script::Module m = torch::jit::load("m.pt");` → `m.forward({input}).toTensor()` |
| Python の `state_dict` を C++ の `torch::nn` へ | **直接は不可**(pickle された `OrderedDict` を C++ `torch::load` は解釈しない)。TorchScript 経由にするか、テンソルを個別に `.pt` へ書き出して C++ で読む |
| C++ 保存モデルを Python で | `torch::save` の zip は Python の `torch.jit.load` で部分的に読めることがあるが保証されない。相互運用が要件なら最初から TorchScript に統一 |
| 生テンソルの受け渡し | `torch::pickle_save` / `torch::pickle_load`(`c10::IValue` 単位)や `.npy` 経由 |

### 10-7. TorchScript(`torch::jit`)

```cpp
#include <torch/script.h>

torch::jit::script::Module module = torch::jit::load("traced_model.pt");
module.to(torch::kCUDA);
module.eval();

std::vector<torch::jit::IValue> inputs{ input_tensor };
torch::Tensor output = module.forward(inputs).toTensor();
```

TorchScript は「Python の学習資産を C++ 本番環境で動かす」ための橋。
本プロジェクトはモデル定義自体を C++ 側で行うため、当面は `torch::save`(§10-3)が主で、
`torch::jit` は Python 由来モデルを取り込む必要が出たときの選択肢。

### 10-8. 本プロジェクトでの位置づけ

[IModelStore](../src/training/application/interfaces/IModelStore.hpp)(application 層のポート)が
`save(const IModel&, path)` / `load(IModel&, path)` を宣言し、
具象 `TorchModelStore`(infrastructure 層、実装中)が `torch::save` / `serialize::OutputArchive` を使う想定。

課題:[TorchModel](../src/training/infrastructure/torchModel/TorchModel.hpp) は
`std::vector<std::shared_ptr<ILayer>>` を持つ**自前の集約**であって `torch::nn::Module` ではない。
そのため `torch::save(module, path)` を直接は使えず、以下のいずれかを選ぶ:

1. `TorchModel::parameters()`(`std::vector<at::Tensor>`)を `torch::save(vector, path)` で保存し、
   ロード時は `torch::NoGradGuard` 下で `param.copy_(loaded[i])` で書き戻す(最も簡単。構造の一致は呼び出し側責務)
2. 各 `ILayer` に `save(OutputArchive&)` / `load(InputArchive&)` を追加し、`TorchModel` が層ごとに委譲する
   (名前付きで保存でき拡張しやすい)
3. `TorchModel` 自体を `torch::nn::Module` 化する(libtorch への依存が上位に漏れるため、
   クリーンアーキテクチャ方針とはトレードオフ)

---

## 11. データ入力(`torch::data`)

C++ 版データパイプライン。`Dataset` → `Transform` → `DataLoader` の構成。

```cpp
#include <torch/data.h>

auto dataset = torch::data::datasets::MNIST("./data")
                   .map(torch::data::transforms::Normalize<>(0.1307, 0.3081))
                   .map(torch::data::transforms::Stack<>());

auto loader = torch::data::make_data_loader(
    std::move(dataset),
    torch::data::DataLoaderOptions().batch_size(64).workers(2));

for (auto &batch : *loader) {
    torch::Tensor data = batch.data;
    torch::Tensor target = batch.target;
}
```

| 要素 | 内容 |
|---|---|
| `datasets::MNIST` 等 | 組み込みデータセット。自作は `torch::data::datasets::Dataset<Self>` を継承し `get(index)` / `size()` を実装 |
| `transforms::Normalize` / `Stack` / `Lambda` | サンプル変換・バッチ化 |
| `make_data_loader` | `StatelessDataLoader`(map-style)/ `StatefulDataLoader` を生成 |
| `samplers::RandomSampler` / `SequentialSampler` / `DistributedRandomSampler` | インデックス供給 |

本プロジェクトは独自の [IDatasetRepository](../src/training/application/interfaces/IDatasetRepository.hpp) +
OpenCV デコードで前処理パイプラインを自作しており、`torch::data` は現状使っていない。

---

## 12. デバイス / CUDA

```cpp
#include <torch/cuda.h>

bool hasCuda = torch::cuda::is_available();
int nGpu = torch::cuda::device_count();

torch::Device device(hasCuda ? torch::kCUDA : torch::kCPU);
torch::Tensor t = torch::randn({3, 3}).to(device);
model->to(device);
```

| API | 意味 |
|---|---|
| `torch::cuda::is_available()` | CUDA ランタイム + GPU が使えるか |
| `torch::cuda::cudnn_is_available()` | cuDNN の有無 |
| `torch::Device(torch::kCUDA, 0)` | デバイス指定 |
| `tensor.to(device)` / `module->to(device)` | 転送(テンソルはコピー、モジュールは in-place) |
| `torch::cuda::synchronize()` | GPU 処理完了待ち(ベンチマーク時) |

**規約**:モデルと入力テンソルは同じデバイスに揃える。混在すると実行時エラー。

---

## 13. 実行時制御・パフォーマンス

| API | 用途 |
|---|---|
| `torch::NoGradGuard g;` | 勾配追跡停止(パラメータ更新・検証ループ) |
| `torch::InferenceMode g;` | 推論専用の強い最適化(バージョンカウンタも省略) |
| `torch::AutoGradMode g(false);` | `NoGradGuard` と同義の明示形 |
| `torch::manual_seed(42)` | 乱数シード固定(再現性) |
| `torch::set_num_threads(n)` | CPU 演算スレッド数 |
| `at::globalContext().setBenchmarkCuDNN(true)` | cuDNN の最適アルゴリズム自動探索(入力サイズ固定時に高速化) |
| `torch::autograd::AnomalyMode` | NaN/inf 発生箇所の特定(デバッグ用、低速) |

---

## 14. このプロジェクトでの使用方針(クリーンアーキテクチャ上の位置づけ)

[CLAUDE.md](/CLAUDE.md) の方針に従い、**libtorch という技術詳細への依存は infrastructure 層に閉じ込める**。
`at::Tensor` / `torch::Tensor` だけは層間の受け渡しに使われるため adapters 層まで露出している。

```
entities        : libtorch 非依存(ModelGraph, *Params, ImageData …)
application      : libtorch 非依存。ポート(IModelTrainer, IModelStore, IDatasetRepository)を定義
adapters         : at::Tensor を扱うインターフェース(ILayer, ILoss, IOptimizer, IModel)
                   + 変換アダプタ(BatchTensorConverter, TorchModelTrainer)
infrastructure   : torch::nn / torch::optim / torch::save を直接使う具象実装
```

| 自前の抽象 | 対応する libtorch 機能 | 具象実装 |
|---|---|---|
| [ILayer](../src/training/adapters/interfaces/ILayer.hpp) | `torch::nn::Conv2d` 等の Module | `TorchConv2DLayer`, `TorchPoolingLayer`, `TorchLinearLayer`, `TorchBatchNormLayer`, `TorchActivationLayer` |
| [ILayerBuilder](../src/training/adapters/interfaces/ILayerBuilders.hpp) | Module のファクトリ | `TorchLayerBuilder`(`std::visit` で `LayersParams` を分岐) |
| [ILoss](../src/training/adapters/interfaces/ILoss.hpp) | `F::cross_entropy`, `F::mse_loss` | `CrossEntropy`, `MseLoss` |
| [IOptimizer](../src/training/adapters/interfaces/IOptimizer.hpp) | `torch::optim::{Adam,AdamW,SGD}` | `AdamOptimizer`, `AdamWOptimizer`, `SGDOptimizer` |
| [IActivation](../src/training/adapters/interfaces/IActivation.hpp) | `torch::softmax`, `torch::relu` 等 | `ReLU`, `Sigmoid`, `Tanh`, `Softmax` |
| [IModel](../src/training/adapters/interfaces/IModel.hpp) | 層の集約 + forward/backward | `TorchModel` |
| [IModelStore](../src/training/application/interfaces/IModelStore.hpp) | `torch::save` / `serialize::OutputArchive` | `TorchModelStore`(実装中) |
| [BatchTensorConverter](../src/training/adapters/impl/BatchTensorConverter.hpp) | `torch::tensor` + `reshape` | 同左(テンプレートで `ImageData`/`NormalizedImageData` に対応) |

---

## 15. 現在の実装状況(2026-08-31 時点)

- **Tensor 変換**:[BatchTensorConverter](../src/training/adapters/impl/BatchTensorConverter.hpp) 実装済み。
  `BatchData<TSample>` → `[N,C,H,W]` float。ターゲットは `[N,H,W]` int64 へ。
- **層**:Conv2D / Pooling(Max/Avg)/ Linear / BatchNorm / Activation のラッパー実装済み。
  `ILayer::forward(input, output)` は出力を参照引数で返す形。
- **損失**:`CrossEntropy`(`ignore_index=255`)、`MseLoss` 実装済み。
- **optimizer**:Adam / AdamW / SGD 実装済み。`unique_ptr` で不完全型を回避。
- **学習ループ**:[TorchModel::train](../src/training/infrastructure/torchModel/TorchModel.cpp) に
  forward → loss → `backward()` → `step()` の 1 イテレーションが実装済み。損失値を `std::cout` に出力。
- **保存/読み込み**:[IModelStore](../src/training/application/interfaces/IModelStore.hpp) インターフェースのみ定義。
  `TorchModelStore` は未実装(§10-8 の方針を検討中)。
- **データローダ**:`torch::data` 未使用。OpenCV ベースの自前パイプライン。
- **デバイス**:現状 CPU 前提。`.to(device)` による GPU 対応は未着手。

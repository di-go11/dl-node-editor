# OpenCV 仕様書

このプロジェクト(ai-engine)で使用しているOpenCVのバージョン・導入モジュール・APIの使い方をまとめたリファレンスです。

## 1. バージョン・導入方法

| 項目 | 内容 |
|---|---|
| バージョン | 4.5.4 (`4.5.4+dfsg-9ubuntu4`) |
| 導入元 | Ubuntu 22.04 標準リポジトリ(`apt`) |
| インストールパッケージ | `libopencv-dev`(開発用ヘッダー一式をまとめて導入するメタパッケージ) |
| インストール場所 | [.devcontainer/Dockerfile](../../../.devcontainer/Dockerfile) |
| CMakeでの検出 | `find_package(OpenCV REQUIRED)`([CMakeLists.txt](../CMakeLists.txt)) |
| リンク | `target_link_libraries(ai_engine_lib PRIVATE ... ${OpenCV_LIBS})` |
| include | `#include <opencv2/opencv.hpp>`(全モジュールをまとめて読み込むヘッダー) |

## 2. 導入されているモジュール一覧

`libopencv-dev`は以下のモジュールをまとめてインストールする(`dpkg -l | grep opencv`で確認済み)。

| モジュール | 役割 |
|---|---|
| `core` | `cv::Mat`など基本データ構造・行列演算 |
| `imgcodecs` | 画像ファイルの読み込み/書き出し(`imread`/`imwrite`) |
| `imgproc` | 色空間変換・リサイズ・フィルタ処理等の画像処理 |
| `highgui` | ウィンドウ表示・GUI(サーバー環境では通常未使用) |
| `videoio` | 動画・カメラ入出力 |
| `video` | 動画解析(オプティカルフロー等) |
| `calib3d` | カメラキャリブレーション・3次元復元 |
| `features2d` | 特徴点検出・記述子抽出 |
| `flann` | 高速近傍探索 |
| `dnn` | ディープラーニングモデルの推論実行 |
| `ml` | 従来型の機械学習アルゴリズム |
| `objdetect` | 物体検出(Haar Cascade等) |
| `photo` | 画像修復・ノイズ除去等 |
| `stitching` | パノラマ画像合成 |
| `shape` | 形状記述子・マッチング |
| `superres` | 超解像 |
| `videostab` | 動画の手ブレ補正 |
| `viz` | 3Dデータ可視化 |
| `contrib` | 上記以外の追加アルゴリズム集 |

本プロジェクトでは主に**`imgcodecs`(画像読み込み)**と**`imgproc`(色空間変換)**のみを使用する想定。他モジュールは`libopencv-dev`導入時に付随して入っているだけで、明示的な利用予定は現時点でない。

## 3. このプロジェクトでの使用方針(クリーンアーキテクチャ上の位置づけ)

[CLAUDE.md](/CLAUDE.md)の方針に従い、OpenCVという技術詳細への依存はinfrastructure層に閉じ込める。

```
IImageDecoder (application/interfaces, ポート)
  └─ decode(imagePath: string) -> ImageData
        │
        ▼
OpenCvImageDecoder (infrastructure/dataset, 具象実装)
  └─ cv::imread 等、OpenCVのAPIを直接使用
```

- [IImageDecoder.hpp](../src/training/application/interfaces/IImageDecoder.hpp) はOpenCVを一切importせず、`std::string`(パス)を受け取り自前の`ImageData`(entities層のDTO)を返す抽象インターフェースとして定義されている。
- [OpenCvImageDecoder.hpp](../src/training/infrastructure/dataset/OpenCvImageDecoder.hpp) / `.cpp` がその具象実装で、ここだけが`<opencv2/opencv.hpp>`をincludeする。
- **重要な契約**: OpenCVは画像を**BGR順**で読み込むが、`IImageDecoder::decode()`の事後条件として「戻り値は必ずRGB順・CHW形式であること」を実装側が保証する、とヘッダーコメントに明記されている。そのため`OpenCvImageDecoder`側で`cv::cvtColor(image, image, cv::COLOR_BGR2RGB)`等によるBGR→RGB変換が必須。

## 4. 主要API仕様(このプロジェクトで使う範囲)

### `cv::Mat`(core モジュール)

画像データを保持する基本クラス。行列(2次元配列+チャンネル)として画像を表現する。

```cpp
cv::Mat image; // 空のMat
```

- `image.rows` / `image.cols`: 高さ・幅
- `image.channels()`: チャンネル数(グレースケール=1, カラー=3, アルファ付き=4)
- `image.empty()`: 読み込み失敗時などに空かどうかを判定
- `image.data`: 生ピクセルデータへのポインタ(`unsigned char*`)
- `image.type()`: データ型(`CV_8UC3`=8bit符号なし整数・3チャンネル、など)

### `cv::imread`(imgcodecs モジュール)

画像ファイルを読み込み`cv::Mat`として返す。

```cpp
cv::Mat image = cv::imread(imagePath, cv::IMREAD_COLOR);
```

| フラグ | 意味 |
|---|---|
| `cv::IMREAD_COLOR` | 常に3チャンネルカラー(BGR)として読み込む(デフォルト相当) |
| `cv::IMREAD_GRAYSCALE` | 常にグレースケール(1チャンネル)として読み込む |
| `cv::IMREAD_UNCHANGED` | ファイルにある通りのチャンネル数(アルファ含む)で読み込む |

読み込みに失敗した場合、例外は投げず**空の`cv::Mat`(`image.empty() == true`)を返す**。呼び出し側で必ず`empty()`チェックが必要。

### `cv::cvtColor`(imgproc モジュール)

色空間を変換する。

```cpp
cv::Mat rgbImage;
cv::cvtColor(bgrImage, rgbImage, cv::COLOR_BGR2RGB);
```

`OpenCvImageDecoder`でBGR→RGB変換に使用する想定。

### `cv::imwrite`(imgcodecs モジュール、将来的な出力用)

```cpp
cv::imwrite(outputPath, image);
```

推論結果の画像出力等で将来的に使う可能性がある(現時点では未実装)。

### `cv::resize`(imgproc モジュール)— 画像リサイズ

`OpenCvImageResizer`(infrastructure/image)の中核で使用するAPI。入力画像を指定サイズに拡大・縮小する。

#### 位置づけ:幾何変換とリサンプリング

画像のリサイズは、画像処理では**幾何変換(geometric transformation)**の一種として扱われる。幾何変換とは「出力画像の各画素が、入力画像のどの座標に対応するか」を写像で定めて画素値を作り直す操作の総称で、リサイズはそのうち縦横方向の拡大・縮小(スケーリング)に相当する。

拡大・縮小では出力画素の中心が入力画像上の**非整数座標**に落ちる(例:横2倍に拡大すると出力の x=1 は入力の x=0.5 に対応)。整数格子上にしか値を持たない元画像から、非整数座標の画素値を推定する処理を**補間(interpolation)**または**リサンプリング(resampling)**と呼ぶ。`cv::resize`の品質と速度は、どの補間法を選ぶかでほぼ決まる。

#### シグネチャ

```cpp
void cv::resize(
    InputArray  src,            // 入力画像
    OutputArray dst,            // 出力画像
    Size        dsize,          // 出力サイズ {width, height}。cv::Size() を渡すと fx/fy から計算
    double      fx = 0,         // 横方向の倍率(dsize が空のときに使用)
    double      fy = 0,         // 縦方向の倍率(dsize が空のときに使用)
    int         interpolation = cv::INTER_LINEAR  // 補間法
);
```

出力サイズの指定方法は2通りで、**どちらか一方**を使う。

| 指定方法 | 使い方 | 用途 |
|---|---|---|
| 絶対サイズ | `dsize` に `cv::Size(width, height)` を渡す(`fx`/`fy` は 0 のまま) | 「224×224 に固定」のように出力解像度が決まっている場合。学習の前処理は基本こちら |
| 相対倍率 | `dsize` に `cv::Size()`(空)を渡し、`fx`/`fy` に倍率を指定 | 「半分に縮小」のようにスケール比で指定したい場合 |

注意点:

- `dsize` は **`{幅, 高さ}`** の順(`cv::Mat` の `rows`/`cols` とは逆順)。
- **アスペクト比は保持されない**。`dsize` の縦横比が入力と違えば画像は歪む。比を保ちたい場合は、呼び出し側でリサイズ後に余白を詰める(letterbox / padding)か、短辺基準でリサイズしてから中央切り抜き(center crop)する処理を自前で組む必要がある。
- 入力と出力は別の `cv::Mat` にする(in-place 不可。`src` と `dst` に同じ変数を渡してはいけない)。
- チャンネル数は保持される(3ch入力なら3ch出力)。`CV_8U`(8bit整数)でも `CV_32F`(float)でも動作するため、正規化済みの float 画像をそのままリサイズできる。

#### 補間法(interpolation)の種類と原理

`interpolation` 引数に渡すフラグ。上から順に「速いが粗い」→「遅いが滑らか」。

| フラグ | 参照する近傍 | 原理 | 特徴 |
|---|---|---|---|
| `cv::INTER_NEAREST` | 1画素 | **最近傍補間**。出力座標に最も近い入力画素の値をそのまま使う | 最速。値を一切混ぜないのでラベル画像(セグメンテーションのマスク等)の縮小に必須。写真ではジャギー(階段状のギザギザ)が目立つ |
| `cv::INTER_LINEAR` | 2×2画素 | **双線形補間(bilinear)**。周囲4画素を距離に応じて線形加重平均する | OpenCVのデフォルト。速度と品質のバランスが良く、拡大時の標準的選択 |
| `cv::INTER_CUBIC` | 4×4画素 | **双三次補間(bicubic)**。3次多項式で16画素を加重。エッジ付近でわずかにオーバーシュート(リンギング)する | `INTER_LINEAR` より滑らかでシャープ。**拡大**に向く。線形の約数倍遅い |
| `cv::INTER_AREA` | 縮小率に応じた領域 | **ピクセル領域関係(pixel area relation)による再サンプリング**。出力1画素が覆う入力領域内の画素を平均する(縮小時は面積平均、拡大時は `INTER_NEAREST` 相当にフォールバック) | **縮小に最適**。平均を取るため折り返し(エイリアシング)やモアレを抑えられる。縮小で他の補間を使うと間の画素が捨てられて情報が欠落する |
| `cv::INTER_LANCZOS4` | 8×8画素 | **Lanczos補間**。sinc関数を窓関数で打ち切ったカーネルで64画素を加重 | 最も高品質でシャープだが最も遅い。リンギングは `INTER_CUBIC` より強く出ることがある |

#### 拡大・縮小での使い分け(重要)

補間法は「拡大か縮小か」で最適解が変わる。

- **拡大(アップサンプリング)**:`INTER_LINEAR`(標準)または `INTER_CUBIC`(高品質)。存在しない画素を作り出す方向なので、滑らかに内挿できる手法が向く。
- **縮小(ダウンサンプリング)**:`INTER_AREA`。縮小は複数の入力画素を1画素にまとめる操作であり、事前のローパスフィルタ(平均化)なしにサンプリングすると**エイリアシング**(高周波成分が低周波の偽模様=モアレとして折り返される現象)が生じる。`INTER_AREA` は領域平均がローパスフィルタの役割を果たすためこれを防げる。`INTER_LINEAR` での大幅な縮小はモアレの原因になる。

学習の前処理では入力画像より小さいサイズ(例:224×224)へ縮小することが多いため、**`INTER_AREA` を基本にしつつ、稀に拡大が必要なケースを `INTER_LINEAR` でフォールバックする**、といった実装が定石。

#### 深層学習の前処理として使う際の注意点

1. **PyTorch / Pillow の `resize` と結果が一致しない**:OpenCV の `INTER_LINEAR` は縮小時にアンチエイリアス処理を行わない。一方 PyTorch の `torchvision.transforms.Resize`(`antialias=True`)や Pillow はローパスを掛ける。学習を PyTorch 側、前処理を本エンジン(OpenCV)側で行う場合、**同じ画像でも画素値がずれる**ため、学習・推論で前処理系を統一する必要がある。縮小で `INTER_AREA` を使うと Pillow の挙動に比較的近くなる。
2. **正規化との順序**:リサイズは線形補間なので「正規化 → リサイズ」でも「リサイズ → 正規化」でも数学的にはほぼ等価だが、float で正規化してからリサイズするほうが量子化誤差が乗りにくい。`INTER_CUBIC` / `INTER_LANCZOS4` はオーバーシュートで値域(例 `0.0〜1.0`)を超えることがあるため、必要なら補間後に `cv::Mat` をクリッピングする。
3. **`cv::Mat` のメモリレイアウト**:`cv::resize` は `cv::Mat` の内部レイアウト(HWC・interleaved)を前提に動く。本プロジェクトの `ImageData` は CHW の平坦化 float 配列なので、リサイズ前に `ImageData → cv::Mat`(HWC)へ詰め替え、リサイズ後に再び CHW へ戻す変換が必要(§5 と同じ並び替え問題)。

#### 使用例

```cpp
// ImageData(CHW, float, RGB)から HWC の cv::Mat を組み立てた前提
cv::Mat src;  // CV_32FC3, サイズ (origH, origW)
cv::Mat dst;

const bool shrinking = (dstW < src.cols) || (dstH < src.rows);
const int interp = shrinking ? cv::INTER_AREA : cv::INTER_LINEAR;

cv::resize(src, dst, cv::Size(dstW, dstH), 0, 0, interp);
// dst を CHW に並び替えて ImageData.values へ
```

#### 関連する幾何変換API(参考・現時点で利用予定なし)

| API | 役割 |
|---|---|
| `cv::copyMakeBorder` | 周囲にパディングを追加。アスペクト比保持リサイズ(letterbox)の余白付けに使う |
| `cv::warpAffine` | アフィン変換(回転・平行移動・スケール・せん断を1つの行列で)。データ拡張(augmentation)で使う可能性がある |
| `cv::warpPerspective` | 射影変換(台形補正など) |
| `cv::pyrDown` / `cv::pyrUp` | ガウシアンピラミッドによる 1/2 縮小・2倍拡大。多重解像度処理向け |
| `cv::remap` | 任意の座標マッピングによる汎用リサンプリング |

## 5. `ImageData`との対応関係

[ImageData.hpp](../src/training/entities/domain-objects/ImageData.hpp)は`shape`(`{channels, height, width}`)と`values`(平坦化された`float`配列)を持つ、フレームワーク非依存のDTO。`cv::Mat`から変換する際は:

1. `cv::cvtColor`でBGR→RGBに変換
2. 必要に応じて`cv::Mat::convertTo`で`float`型・`0.0〜1.0`等の正規化スケールに変換
3. `channels × height × width`の順(CHW)で`values`に平坦化して詰める(OpenCVの`cv::Mat`は内部的にHWC(interleaved)でデータを持つため、単純なポインタコピーではなく並び替えが必要な点に注意)

## 6. 現在の実装状況(2026-08-28時点)

[OpenCvImageDecorder.cpp](../src/training/infrastructure/dataset/OpenCvImageDecorder.cpp)は`cv::imread`で画像を読み込む行のみが実装されており、BGR→RGB変換・`ImageData`への詰め替え・`return`文が未実装。また、ファイル名が`OpenCvImageDecorder.cpp`(Decorder)である一方、クラス名は`OpenCvImageDecoder`(Decoder)となっており、綴りが一致していない。今後の実装時に合わせて修正が必要。

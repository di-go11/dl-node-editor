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

## 5. `ImageData`との対応関係

[ImageData.hpp](../src/training/entities/domain-objects/ImageData.hpp)は`shape`(`{channels, height, width}`)と`values`(平坦化された`float`配列)を持つ、フレームワーク非依存のDTO。`cv::Mat`から変換する際は:

1. `cv::cvtColor`でBGR→RGBに変換
2. 必要に応じて`cv::Mat::convertTo`で`float`型・`0.0〜1.0`等の正規化スケールに変換
3. `channels × height × width`の順(CHW)で`values`に平坦化して詰める(OpenCVの`cv::Mat`は内部的にHWC(interleaved)でデータを持つため、単純なポインタコピーではなく並び替えが必要な点に注意)

## 6. 現在の実装状況(2026-08-28時点)

[OpenCvImageDecorder.cpp](../src/training/infrastructure/dataset/OpenCvImageDecorder.cpp)は`cv::imread`で画像を読み込む行のみが実装されており、BGR→RGB変換・`ImageData`への詰め替え・`return`文が未実装。また、ファイル名が`OpenCvImageDecorder.cpp`(Decorder)である一方、クラス名は`OpenCvImageDecoder`(Decoder)となっており、綴りが一致していない。今後の実装時に合わせて修正が必要。

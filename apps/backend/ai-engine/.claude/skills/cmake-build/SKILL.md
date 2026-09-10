---
name: cmake-build
description: ai-engine(C++/libtorch)を CMake でビルドする。ビルド並列度は必ず -j2 に制限する。「ビルドして」「コンパイルが通るか確認して」「テストを実行して」のような依頼で使う。
---

# cmake-build

このプロジェクト(`/workspaces/apps/backend/ai-engine`)を CMake + Ninja でビルドするときの手順。

## 最重要ルール

**ビルドの並列度は必ず `-j2` に制限する。** `-j` 無指定(=コア数フル)や `-j4` 以上は使わない。
libtorch のリンクを含むビルドはメモリを大量に消費し、並列度を上げると devcontainer が OOM で落ちるため。

## 手順

1. 初回、または `CMakeLists.txt` を変更した場合は configure:

   ```bash
   cmake -S . -B build -G Ninja
   ```

   (`build/` が既に存在すれば通常はスキップしてよい)

2. ビルド。**必ず `-j2` を付ける**:

   ```bash
   cmake --build build -j2
   ```

   特定ターゲットだけビルドしたいとき:

   ```bash
   cmake --build build -j2 --target ai_engine_app
   ```

   主なターゲット: `ai_engine_lib`(ライブラリ), `ai_engine_app`(実行ファイル, main.cpp),
   各 `*_test`(tests/ 配下)。

3. `ninja` を直接呼ぶ場合も同様に並列度を制限する:

   ```bash
   ninja -C build -j2
   ```

## テスト実行

```bash
ctest --test-dir build --output-on-failure -j2
```

## 注意点

- コンパイラは devcontainer の設定で自動的に ccache 経由になる(`CMAKE_CXX_COMPILER_LAUNCHER=ccache`)。
  ビルドが速くならないときは `ccache -s` でヒット率を確認する。無効化する必要はない。
- クリーンビルドが必要なときは `build/` を消して 1. からやり直す。`build/` 以下は生成物なのでコミット対象外。
- ビルドがメモリ不足で失敗した(`c++: fatal error: Killed signal terminated program cc1plus` 等)場合は、
  並列度をさらに下げて `-j1` で再実行する。

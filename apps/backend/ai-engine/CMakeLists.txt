cmake_minimum_required(VERSION 3.18)
project(AIEngineBackend)

# C++のバージョンを 17 以上に設定（LibTorchの必須条件）
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# libtorchのパスを指定する（Dockerfileで指定したパスを使用）
set(CMAKE_PREFIX_PATH "/opt/libtorch" ${CMAKE_PREFIX_PATH})

# 1. 以前のDockerfileで指定した環境変数（/opt/libtorch）からLibTorchを探す
find_package(Torch REQUIRED)

# 1-2. 画像デコード(JPEG/PNG)用にOpenCVを探す(Dockerfileでlibopencv-devをインストール済み)
find_package(OpenCV REQUIRED)

file(GLOB_RECURSE ALL_SRCS "src/training/*.cpp")

# 2. ライブラリを作成(adapter/application/entities/infrastructure配下の実装をまとめる)
add_library(ai_engine_lib
	${ALL_SRCS}
)

# ヘッダーファイルを探す「基準の場所」を src フォルダに設定する
target_include_directories(ai_engine_lib PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

# 3. LibTorch/OpenCVのインクルードパスとライブラリをターゲットに設定する
target_include_directories(ai_engine_lib PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
target_link_libraries(ai_engine_lib PRIVATE "${TORCH_LIBRARIES}" ${OpenCV_LIBS})

# 4. (重要) CMakeの仕様で必要なコンパイルフラグを追加
set_property(TARGET ai_engine_lib PROPERTY CXX_STANDARD 17)

# 5. main.cppを実行可能ファイルとしてビルドし、上記ライブラリをリンクする
add_executable(ai_engine_app main.cpp)
target_include_directories(ai_engine_app PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/src
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
)
target_link_libraries(ai_engine_app PRIVATE ai_engine_lib "${TORCH_LIBRARIES}")
set_property(TARGET ai_engine_app PROPERTY CXX_STANDARD 17)

# libtorch(CUDAビルド)が依存するcuSPARSELt/NVSHMEM等、この環境に入っていない
# オプションのCUDAライブラリのシンボル解決をリンク時ではなく実行時まで遅延させる。
# これらは今回のような疎通確認コード(スパース演算・マルチGPU通信を使わない)では
# 実行時にも参照されないため安全。
target_link_options(ai_engine_app PRIVATE "-Wl,--allow-shlib-undefined")

# 6. 画像デコード〜正規化〜クラスID変換パイプラインの疎通確認テスト
add_executable(image_pipeline_test tests/image_pipeline_smoke_test.cpp)
target_include_directories(image_pipeline_test PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/src
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
target_link_libraries(image_pipeline_test PRIVATE ai_engine_lib "${TORCH_LIBRARIES}" ${OpenCV_LIBS})
target_link_options(image_pipeline_test PRIVATE "-Wl,--allow-shlib-undefined")
set_property(TARGET image_pipeline_test PROPERTY CXX_STANDARD 17)
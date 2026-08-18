cmake_minimum_required(VERSION 3.18)
project(AIEngineBackend)

# C++のバージョンを 17 以上に設定（LibTorchの必須条件）
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

set(Torch_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/libtorch/share/cmake/Torch")

# 1. 以前のDockerfileで指定した環境変数（/opt/libtorch）からLibTorchを探す
find_package(Torch REQUIRED)

file(GLOB_RECURSE ALL_SRCS "src/training/*.cpp")

# 2. ライブラリを作成
add_library(ai_engine_app
	#main file
	main.cpp

	#adapter directory
	${ALL_SRCS}
)

# ヘッダーファイルを探す「基準の場所」を src フォルダに設定する
target_include_directories(ai_engine_app PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

# 3. LibTorchのインクルードパスとライブラリをターゲットに設定する
target_include_directories(ai_engine_app PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
)
target_link_libraries(ai_engine_app PRIVATE "${TORCH_LIBRARIES}")

# 4. (重要) CMakeの仕様で必要なコンパイルフラグを追加
set_property(TARGET ai_engine_app PROPERTY CXX_STANDARD 17)
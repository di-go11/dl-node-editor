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

# 7. リサイズ(Warp / Letterbox / CenterCrop)の疎通確認テスト
add_executable(image_resize_test tests/image_resize_test.cpp)
target_include_directories(image_resize_test PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/src
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
target_link_libraries(image_resize_test PRIVATE ai_engine_lib "${TORCH_LIBRARIES}" ${OpenCV_LIBS})
target_link_options(image_resize_test PRIVATE "-Wl,--allow-shlib-undefined")
set_property(TARGET image_resize_test PROPERTY CXX_STANDARD 17)

# 8. validation(TorchModelEvaluator)の loss / pixel accuracy / mIoU 集計テスト
add_executable(model_evaluator_test tests/model_evaluator_test.cpp)
target_include_directories(model_evaluator_test PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/src
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
target_link_libraries(model_evaluator_test PRIVATE ai_engine_lib "${TORCH_LIBRARIES}" ${OpenCV_LIBS})
target_link_options(model_evaluator_test PRIVATE "-Wl,--allow-shlib-undefined")
set_property(TARGET model_evaluator_test PROPERTY CXX_STANDARD 17)

# 9. ベストモデルの自動チェックポイント保存(BestMetricTracker / TrainModelUsecase)テスト
add_executable(best_checkpoint_test tests/best_checkpoint_test.cpp)
target_include_directories(best_checkpoint_test PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/src
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
target_link_libraries(best_checkpoint_test PRIVATE ai_engine_lib "${TORCH_LIBRARIES}" ${OpenCV_LIBS})
target_link_options(best_checkpoint_test PRIVATE "-Wl,--allow-shlib-undefined")
set_property(TARGET best_checkpoint_test PROPERTY CXX_STANDARD 17)

# 10. TorchCheckpointStore の save→load ラウンドトリップ(実 TorchModel + AdamOptimizer)テスト
add_executable(checkpoint_roundtrip_test tests/checkpoint_roundtrip_test.cpp)
target_include_directories(checkpoint_roundtrip_test PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/src
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
target_link_libraries(checkpoint_roundtrip_test PRIVATE ai_engine_lib "${TORCH_LIBRARIES}" ${OpenCV_LIBS})
target_link_options(checkpoint_roundtrip_test PRIVATE "-Wl,--allow-shlib-undefined")
set_property(TARGET checkpoint_roundtrip_test PROPERTY CXX_STANDARD 17)
# テストが生成する .pt は tests/ 配下の一時ディレクトリに閉じ込める(実行後に削除)
target_compile_definitions(checkpoint_roundtrip_test PRIVATE
	CHECKPOINT_TEST_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/checkpoint_roundtrip_tmp")

# 11. ModelGraphArchive(writeModelGraph / readModelGraph)のラウンドトリップテスト
add_executable(model_graph_archive_test tests/model_graph_archive_test.cpp)
target_include_directories(model_graph_archive_test PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/src
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
target_link_libraries(model_graph_archive_test PRIVATE ai_engine_lib "${TORCH_LIBRARIES}" ${OpenCV_LIBS})
target_link_options(model_graph_archive_test PRIVATE "-Wl,--allow-shlib-undefined")
set_property(TARGET model_graph_archive_test PROPERTY CXX_STANDARD 17)
target_compile_definitions(model_graph_archive_test PRIVATE
	MODEL_GRAPH_ARCHIVE_TEST_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/model_graph_archive_tmp")

# 12. CheckpointModelLoader の「.pt 単体からのモデル再構築」テスト
add_executable(checkpoint_rebuild_test tests/checkpoint_rebuild_test.cpp)
target_include_directories(checkpoint_rebuild_test PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/src
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
target_link_libraries(checkpoint_rebuild_test PRIVATE ai_engine_lib "${TORCH_LIBRARIES}" ${OpenCV_LIBS})
target_link_options(checkpoint_rebuild_test PRIVATE "-Wl,--allow-shlib-undefined")
set_property(TARGET checkpoint_rebuild_test PROPERTY CXX_STANDARD 17)
target_compile_definitions(checkpoint_rebuild_test PRIVATE
	CHECKPOINT_REBUILD_TEST_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/checkpoint_rebuild_tmp")

# 13. 実データ(VOC)での学習パイプライン スモークテスト
add_executable(training_smoke_test tests/training_smoke_test.cpp)
target_include_directories(training_smoke_test PRIVATE
	${CMAKE_CURRENT_SOURCE_DIR}/src
	${CMAKE_CURRENT_SOURCE_DIR}
	${TORCH_INCLUDE_DIRS}
	${OpenCV_INCLUDE_DIRS}
)
target_link_libraries(training_smoke_test PRIVATE ai_engine_lib "${TORCH_LIBRARIES}" ${OpenCV_LIBS})
target_link_options(training_smoke_test PRIVATE "-Wl,--allow-shlib-undefined")
set_property(TARGET training_smoke_test PROPERTY CXX_STANDARD 17)
target_compile_definitions(training_smoke_test PRIVATE
	SMOKE_SRC_DATASET="${CMAKE_CURRENT_SOURCE_DIR}/dataset/train"
	SMOKE_TMP_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/training_smoke_tmp")
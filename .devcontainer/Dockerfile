FROM nvidia/cuda:12.6.2-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. 開発用ツールと依存ライブラリをインストール
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    ninja-build \
    clang \
    git \
    pkg-config \
    ca-certificates \
    libgmock-dev \
    libgtest-dev \
    libopencv-dev \
    wget \
    unzip \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. LibTorchを配置するディレクトリに移動
WORKDIR /opt

# 3. LibTorch (CUDA 12.6 / cxx11 ABI) をダウンロードして解凍
RUN wget -O libtorch.zip https://download.pytorch.org/libtorch/cu126/libtorch-shared-with-deps-2.13.0%2Bcu126.zip \
    && unzip -q libtorch.zip \
    && rm libtorch.zip

# 4. CMake用の環境変数を設定 (find_package(Torch) が動くようにする)
ENV CMAKE_PREFIX_PATH=/opt/libtorch

# 5. docker-compose.yml に合わせて作業ディレクトリを戻す
WORKDIR /workspaces/apps/backend/ai-engine
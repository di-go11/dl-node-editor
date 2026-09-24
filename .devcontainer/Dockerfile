FROM nvidia/cuda:13.2.1-cudnn-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

# 1. 開発用ツールと依存ライブラリをインストール
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    ccache \
    ninja-build \
    clang \
    gdb \
    git \
    pkg-config \
    ca-certificates \
    libgmock-dev \
    libgtest-dev \
    libopencv-dev \
    wget \
    unzip \
    # LibTorch(CUDAビルド)のtorch_cuda.so/torch_nvshmem.soが実行時に要求する
    # オプションのCUDAライブラリ(構造化スパース演算・マルチGPU共有メモリ)
    libcusparselt0-cuda-13 \
    libnvshmem3-cuda-13 \
    libnccl2 \
    libgrpc++-dev \
    libprotobuf-dev \
    protobuf-compiler \
    protobuf-compiler-grpc \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    # libcusparseLt/libnvshmemはバージョン別サブディレクトリに配置され、
    # 標準のライブラリ検索パスに含まれないため、ldconfigに明示的に追加する
    && echo "/usr/lib/x86_64-linux-gnu/libcusparseLt/13" > /etc/ld.so.conf.d/cusparselt.conf \
    && echo "/usr/lib/x86_64-linux-gnu/nvshmem/13" > /etc/ld.so.conf.d/nvshmem.conf \
    && ldconfig

# 1-4. grpcurl(gRPC版のcurl。ターミナルからRPCを直接叩いて疎通確認するツール)
#      apt には無いので GitHub リリースのバイナリを取得する。バージョンは固定。
RUN wget -q https://github.com/fullstorydev/grpcurl/releases/download/v1.9.1/grpcurl_1.9.1_linux_x86_64.tar.gz -O /tmp/grpcurl.tar.gz \
    && tar -xzf /tmp/grpcurl.tar.gz -C /usr/local/bin grpcurl \
    && chmod 755 /usr/local/bin/grpcurl \
    && rm /tmp/grpcurl.tar.gz

# 2. LibTorchを配置するディレクトリに移動
WORKDIR /opt

# 3. LibTorch (CUDA 13.2 / cxx11 ABI) をダウンロードして解凍
RUN wget -O libtorch.zip https://download.pytorch.org/libtorch/cu132/libtorch-shared-with-deps-2.13.0%2Bcu132.zip \
    && unzip -q libtorch.zip \
    && rm libtorch.zip

# 4. CMake用の環境変数を設定 (find_package(Torch) が動くようにする)
ENV CMAKE_PREFIX_PATH=/opt/libtorch

# 5. ccache の設定
#    - /usr/lib/ccache には gcc/g++/clang などのシンボリックリンクが置かれるので PATH 先頭に追加
#    - CMAKE_*_COMPILER_LAUNCHER で CMake/Ninja のビルドからも確実に ccache を経由させる
#    - CCACHE_DIR はキャッシュ保存先。docker-compose.yml の名前付きボリュームで永続化する
ENV PATH="/usr/lib/ccache:${PATH}"
ENV CCACHE_DIR=/ccache
ENV CCACHE_MAXSIZE=5G
ENV CMAKE_C_COMPILER_LAUNCHER=ccache
ENV CMAKE_CXX_COMPILER_LAUNCHER=ccache
RUN mkdir -p /ccache && ccache --version

# 6. docker-compose.yml に合わせて作業ディレクトリを戻す
WORKDIR /workspaces/apps/backend/ai-engine

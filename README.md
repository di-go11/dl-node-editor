# <img src="docs/images/node-ai-builder-icon.svg" width="32" align="center"> DNE: Deep Learning Node Editor　
---
<div style="font-size: 1.4rem"><strong>ノーコードで目標のタスクに適したAIモデルの構築ができるアプリケーション．</strong></div>

![alt](./docs/images/ReadMe.gif)

## 構成
![alt](./docs/images/structure-C4.svg)

## 必要環境

### 共通

|項目|要件|
|---|---|
| OS | Linux (x86_64)、または Windows 11 + WSL2 |
| CPUアーキテクチャ | x86_64(ARMは非対応)|
|GPU| NVIDIA GPU(CUDA 13以上対応)|
|NVIDIAドライバ| CUDA 13.2以上に対応するバージョン|
|Docker| Docker Engine + Docker Compose v2|
|GPUコンテナ実行| Nvidia Container Toolkit(Linuxの場合)|
|メモリ| 16GB以上|
|ブラウザ| edge / chromeなど|

> Windows の場合は Docker Desktop(WSL2 バックエンド)を使用
> GPU ドライバは Windows 側にインストールすれば WSL2 からも利用可能。

### 環境構築

#### Cudaのバージョンチェック

```powershell
> nvidia-smi
```
>13.2未満の場合，Nvidiaドライバを更新する．
#### WSL
---

```powershell
> wsl --install
```

#### Dockerの設定

Settings>Resources>WSL integrationから`Enable integration with my default WSL distro`をチェック．UbuntuのスイッチをONにする．

## 起動方法

1. .deploy/.envの設定．

CPUの並列処理の許容値を上げることで，学習中のデータセット読み込み時に発生するボトルネックを抑えることができる．


2. コンテナ起動&サーバー立ち上げ

```powershell
docker compose -f .deploy/compose.prod.yml up -d
```

> 初回起動時はソースコードのビルドを行うため時間がかかる。

3. chrome，edgeのアドレスバーに`http://localhost:25812`を入力

※コンテナの停止
```powershell
docker compose -f .deploy/compose.prod.yml down
```

## 処理の設定

`.deploy/.env` で以下の値を設定できます。

| 環境変数 | 意味 | 既定値 |
|---|---|---|
| `AI_ENGINE_CPUS` | ai-engine(AI 学習)が使える CPU 時間の上限(コア何個分か) | `8` |
| `AI_ENGINE_IMAGE_LOAD_THREADS` | 画像を読み込むときの並列スレッド数(`AI_ENGINE_CPUS` の半分程度が目安) | `4` |
| `AI_ENGINE_MEMORY_LIMIT` | ai-engine が使えるメモリの上限(例: `10g`) | `10g` |
| `DATASET_UPLOAD_MAX_MIB` | アップロードできるデータセット(zip)の最大サイズ [MiB] | なし(**必須**) |
| `DATASET_UNZIP_MAX_MIB` | データセットを展開した後の最大サイズ [MiB] | なし(**必須**) |

> `AI_ENGINE_CPUS` にホストのコア数(WSL2 の場合は WSL に割り当てたコア数)を超える値を指定すると、起動に失敗する。
>
> 設定を変えた後は、次のコマンドを実行するとコンテナが作り直されて反映される。
> ```powershell
> docker compose -f .deploy/compose.prod.yml up -d
> ```

## 使い方

1. データセットから新規データセットをアップロード(.zip形式)
2.　

> 学習の一連のテストをしたい場合[こちらのURL](https://wonderhorn.net/material/VOCdevkit.zip)からPascalVocのデータセットをダウンロード
> zipの中に2007と2012があるため解答した後どちらかを圧縮してアップロードする。

## 開発環境
VS Code の Dev Containers で開発します。コンテナの開き方、各コンポーネントのビルド・テスト方法は [development.md](development.md) を参照。

## 使用技術一覧
![React](https://img.shields.io/badge/Frontend-React-61DAFB?logo=react&logoColor=white) ![Rust](https://img.shields.io/badge/Backend-Rust-000000?logo=rust&logoColor=white) ![C++](https://img.shields.io/badge/AI_Engine-C++%20%2F%20libtorch-00599C?logo=cplusplus&logoColor=white) ![gRPC](https://img.shields.io/badge/IPC-gRPC-244c5a) ![Docker](https://img.shields.io/badge/Deploy-Docker-2496ED?logo=docker&logoColor=white)

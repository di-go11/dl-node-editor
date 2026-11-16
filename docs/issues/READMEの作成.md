# docs:外部向けREADMEの作成

## 問題点

- 現在: リポジトリ直下にREADMEがなく、外部の人がcloneしても起動方法・必要環境・データセットの置き方がわからない。
- 新規: 外部の人がclone直後の何もない状態から `.deploy/compose.prod.yml` で起動し、学習を回せるところまでをREADMEに書く。

## 0. README公開前に片付けること

- 作業ツリーのビルドエラーを直す(このままコミットされると誰もビルドできない)
    - `apps/backend/ai-engine/src/api/grpc/GrpcApp.cpp`: 削除した `path` をまだ参照している / `std::from_chars` 用の `<charconv>` が include されていない
    - `apps/backend/api/crates/adapters/src/http/handler.rs`: `upload_dataset` が書きかけ
- `.dockerignore` の `deploy/data` を `.deploy/data` に直す(今はデータセット・重みがビルドコンテキストに全部送られている)
- LICENSEファイルを追加する(ライセンスがないと、法的には他人が使えない状態になる)
- `docs/就活` を公開リポジトリに置いておいてよいか確認する

## 1. 動作要件

- x86_64 Linux(Ubuntu)または Windows + Docker Desktop(WSL2バックエンド)
    - Jenkinsのデプロイ先は今のところWindows
- Docker Engine + Compose v2(`name:` と `deploy.resources.reservations.devices` は v2 の書き方)
- NVIDIAドライバ: `nvidia-smi` に表示される CUDA Version が 13.2 以上
    - イメージに `NVIDIA_REQUIRE_CUDA=cuda>=13.2` が入っているので、ドライバが古いと起動時に止まる
- NVIDIA Container Toolkit(Linuxのみ。Docker Desktopには含まれている)
- ホストに CUDA Toolkit / libtorch は不要(コンテナが持っていて、ホストからはドライバだけを共有するため)
- GPU世代: CUDA 13 は Maxwell/Pascal/Volta のサポートを外しているので、Turing(RTX 20系)以降のはず → libtorch cu132 の対応アーキテクチャを確認してから書く
- CPU 8コア以上 / メモリ 10GB 以上(`compose.prod.yml` の `cpus: "8"` と `memory: 10g`)
- ディスク: libtorch(CUDA版)だけで数GB。初回ビルドにも時間がかかることを書く
- GPU動作確認用のコマンド: `docker run --rm --gpus all nvidia/cuda:13.2.1-base-ubuntu22.04 nvidia-smi`

## 2. 起動手順

```bash
git clone https://github.com/HT-lab-git/robust-object-detection.git
cd robust-object-detection
mkdir -p .deploy/data/{datasets,weights,api-data}
docker compose -f .deploy/compose.prod.yml up -d --build
# → http://localhost:25812
```

- `.deploy/data` はgitignore対象なので、clone直後には存在しない。Linuxでは作っておかないとDockerがroot所有で自動作成してしまうため、`mkdir` の手順を入れる

## 3. データの置き場所とパスの対応

| ホスト | コンテナ | 用途 |
|---|---|---|
| `.deploy/data/datasets/` | `/datasets`(ai-engine、読み取り専用) | データセット |
| `.deploy/data/weights/` | `/app/models`(ai-engine) | `<model_id>_best.pt` / `<model_id>_last.pt` |
| `.deploy/data/api-data/` | `/data`(api) | SQLite(`training.db`) |

- UIで入力するデータセットパスはai-engineコンテナ内のパス(例: `.deploy/data/datasets/mydata` に置いたなら `/datasets/mydata`)。わかりにくいので必ず書く
    - データセットアップロード機能(`データセットアップロード機能とデータ選択機能.md`)ができたらこの節は書き直す

## 4. データセット形式

Pascal VOCに似ているが、マスクの置き場所と形式が標準のVOCと違うので、外部の人が一番つまずくところ。

```
<dataset_root>/
├── labelmap.txt
├── JPEGImages/<id>.jpg (.jpeg も可)
├── SegmentationClassP/<id>.png   ← カラーマスク(RGBの色がクラスを表す)
└── ImageSets/Segmentation/
    ├── train.txt   (1行に1つの <id>)
    └── val.txt
```

`labelmap.txt`(CVATの Segmentation mask 1.1 エクスポートと同じ形式):

```
# label:color_rgb:parts:actions
background:0,0,0::
classA:36,179,83::
```

- 先頭から順にクラスID 0,1,2,… になる。1行目は background にする(評価で背景クラスとして扱われる)
- 使われるのは先頭2フィールド(ラベル名とRGB)だけ。`#` で始まる行と空行は読み飛ばす
- クラス数はlabelmapの行数で決まる
- `ignore_index`(既定値255)は、マスク中の実クラスIDと重ならない値にする

## 5. 設定できる値

- `AI_ENGINE_LOAD_IMAGE_THREADS`: 画像読み込みのスレッド数(未設定なら1)
- ポート `25812`、CPU/メモリの上限: `compose.prod.yml` を編集して変える

## 6. トラブルシューティング

- `unsatisfied condition: cuda>=13.2` → ドライバが古い
- `range of CPUs is from 0.01 to N` → ホストのコア数が8未満。`cpus` を減らす
- `could not select device driver "nvidia"` → Container Toolkit がない、または未設定(`sudo nvidia-ctk runtime configure --runtime=docker` を実行してDockerを再起動)

## 7. その他

- アーキテクチャの概要(web(nginx) → api(Rust) → gRPC → ai-engine(C++/libtorch))を図にする
- 開発環境(`.devcontainer`)の使い方は別の節か、別のドキュメントにする

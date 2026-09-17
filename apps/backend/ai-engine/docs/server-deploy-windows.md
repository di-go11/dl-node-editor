# 自前 GPU マシン(Windows Server 2022)で学習を動かす手順

対象: Windows Server 2022、NVIDIA GPU、Docker は **WSL2 上の Docker Engine** で
稼働中（Docker Desktop ではない）。インターネット到達可。SSH 不可のため、
**この手順は現地（サーバーのコンソール/RDP）で実行する**前提。

現状の `.devcontainer/Dockerfile` はビルドツールチェーンだけを持つ「土台」イメージで、
リポジトリ本体は `docker-compose.yml` が bind mount で流し込む構成（イメージに
ソースを COPY しない）。この手順もその構成をそのまま踏襲する。

---

## 0. 前提チェック

WSL2 上に Docker Engine が既にある、とのことなので以下を確認するだけでよい：

```bash
# WSL2 の Linux ディストリ(Ubuntu 想定)のシェルで
docker info | head -5          # Docker Engine が動いているか
nvidia-smi                     # Windows 側 NVIDIA ドライバが WSL 越しに見えているか
```

`nvidia-smi` が **WSL2 の中で**通れば、Windows ホスト側の NVIDIA ドライバ
（CUDA on WSL 対応版、概ね R550 以降）は入っている。通らなければ、
Windows 側（WSL の中ではない）に NVIDIA の最新ドライバを入れ直す必要がある
（[NVIDIA CUDA on WSL](https://docs.nvidia.com/cuda/wsl-user-guide/) 参照）。
**WSL2 の中に Linux 用 NVIDIA ドライバを別途入れてはいけない**（Windows 側の
ドライバがそのまま使われる方式のため、競合する）。

---

## 1. NVIDIA Container Toolkit を WSL2 内に入れる

WSL2 の Ubuntu シェルで：

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

# Docker に nvidia runtime を登録して再起動
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### 疎通確認

```bash
docker run --rm --gpus all nvidia/cuda:12.6.2-base-ubuntu22.04 nvidia-smi
```

GPU の情報が表示されれば OK。ここが通らないと以降は進めても無駄なので、
必ず先に確認すること。

---

## 2. リポジトリを取得

`feat/gRPC-function` は `main` にマージ済み（SegNet 対応含む）。`main` を使う。

```bash
git clone https://github.com/HT-lab-git/robust-object-detection.git
cd robust-object-detection
```

---

## 3. データセットを持っていく

`dataset/` は `.gitignore` 対象なので `git clone` では来ない。**SSH が使えないため、
git 以外の方法で運ぶ必要がある**（USB メモリ／社内共有ストレージ／クラウド
ストレージ経由でのダウンロード等）。

持っていった後、リポジトリの以下に置く：

```
robust-object-detection/apps/backend/ai-engine/dataset/train/
  ├── ImageSets/
  ├── JPEGImages/
  ├── SegmentationClass/
  ├── SegmentationClassP/
  ├── SegmentationObject/
  └── labelmap.txt
```

（今の devcontainer の `dataset/train/` と同じ中身をそのままコピーすればよい）

---

## 4. `.config` をこのマシンのパスに合わせる

`apps/backend/ai-engine/.config` は絶対パスがハードコードされている。
`robust-object-detection` をどこに clone したかに合わせて書き換える。

```ini
dataset_path = /workspaces/apps/backend/ai-engine/dataset/train
output_dir   = /workspaces/apps/backend/ai-engine/models
device       = cuda:0
model_architecture = SegNet
```

↑ コンテナ内のパス。手順6で bind mount するとき、ホスト側のリポジトリを
コンテナ内 `/workspaces` にマウントすればこのままで動く（devcontainer と
同じ配置なので、実質書き換え不要なことが多い）。

---

## 5. 土台イメージをビルド

```bash
cd robust-object-detection
docker build -t ai-engine:latest -f .devcontainer/Dockerfile .devcontainer
```

libtorch(CUDA 12.6 版, 約2GB)のダウンロードが走るので少し時間がかかる。

---

## 6. コンテナを起動してビルド & 学習実行

`docker-compose.yml` の `command: sleep` は開発用の待機なので、ここでは
直接学習コマンドを実行する形にする。

```bash
docker run --rm --gpus all \
  -v "$(pwd)":/workspaces \
  -w /workspaces/apps/backend/ai-engine \
  ai-engine:latest \
  bash -c "cmake -S . -B build && cmake --build build -j2 --target ai_engine_app && ./build/ai_engine_app"
```

- `--gpus all`: NVIDIA Container Toolkit 経由で GPU をコンテナに渡す
- `-v "$(pwd)":/workspaces`: リポジトリ全体を bind mount（`.config` の
  パスと一致させる）
- `-j2`: このプロジェクトの既定方針どおりビルド並列度を抑える
  （メモリ不足で落ちるのを防ぐ。マシンのメモリに余裕があれば上げてよい）

学習ログが標準出力に流れ、`models/model_best.pt` / `model_last.pt` が
リポジトリ内に生成される（bind mount なのでホスト側にもそのまま残る）。

### 繰り返し実行する場合

`cmake -S . -B build` は初回だけでよい。2回目以降はビルド済みの `build/`
がホスト側に残っているので：

```bash
docker run --rm --gpus all \
  -v "$(pwd)":/workspaces \
  -w /workspaces/apps/backend/ai-engine \
  ai-engine:latest \
  ./build/ai_engine_app
```

---

## この手順で解決できていない/確認が必要な点

- [x] `feat/gRPC-function` を `main` にマージするかどうか → マージ済み（手順2）
- [ ] データセットの具体的な運び方（USB か社内ストレージか等、手順3）
- [ ] Windows 側 NVIDIA ドライバのバージョンが CUDA 12.6 に対応しているか
      （`nvidia-smi` の出力にある Driver Version / CUDA Version を確認）
- [ ] 長時間学習を back ground で回す運用（`docker run -d` + ログの出し先など）は
      未整備。まずは前面で1回通すところまでを想定した手順

## 関連

- `.devcontainer/Dockerfile` — ビルド環境の定義そのもの（この手順の元ネタ）
- `docs/issues/gpu-support.md` — `device = cuda:0` / GPU 判定まわり
- `docs/issues/grpc-layer.md` — `ai_engine_app --serve` は gRPC サーバー起動。
  今回の学習実行とは別モード

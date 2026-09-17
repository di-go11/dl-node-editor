# 自前 GPU マシン(Windows Server 2022)で学習を動かす手順

対象: Windows Server 2022、NVIDIA GPU。Docker は **Docker Desktop**（WSL2 バックエンド）
経由で使う（WSL2 に Docker Engine 単体を新規インストールする案は不採用。
Docker Desktop が既に入っていたため、そちらの `desktop-linux` コンテキストを使う
運用に決定）。インターネット到達可。SSH 不可のため、**この手順は現地
（サーバーのコンソール/RDP）で実行する**前提。

**社内のライセンス方針を確認すること**: Docker Desktop は組織規模によって
有償サブスクリプションが必要な場合がある（Docker Subscription Service Agreement）。
商用サーバーでの継続利用前に確認してください。

現状の `.devcontainer/Dockerfile` はビルドツールチェーンだけを持つ「土台」イメージで、
リポジトリ本体は `docker-compose.yml` が bind mount で流し込む構成（イメージに
ソースを COPY しない）。この手順もその構成をそのまま踏襲する。

---

## 0〜1. 前提チェック・GPU 疎通確認（完了済み）

**この手順は現地で実施・確認済み。** 以後の作業も同じ WSL2 の Ubuntu シェルの中
（PowerShell ではない）で行う。

```bash
# Docker Desktop 側のエンジンに切り替える(PowerShell 側と別管理なので毎回のシェルで必要)
docker context use desktop-linux

# 疎通確認
docker run --rm hello-world

# GPU が使えるか確認
docker run --rm --gpus all nvidia/cuda:12.6.2-base-ubuntu22.04 nvidia-smi
```

GPU の情報が表示されるところまで確認済み。`nvidia-container-toolkit` の
apt インストールは Docker Desktop 側が内部で処理するため**不要**（当初案の
WSL2 単体 Docker Engine 構成では必要だったが、Docker Desktop 採用により省略）。

もし新しいシェルを開いて `docker run` が `desktop-linux` ではなく `default`
コンテキストで失敗する場合は、上の `docker context use desktop-linux` を
シェルごとに実行し直すこと。

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
- [x] Docker Desktop / WSL2 Engine 単体 のどちらを使うか →
      **Docker Desktop（`desktop-linux` コンテキスト）を使う**で確定。
      GPU 疎通確認済み（`nvidia-smi` がコンテナ内から実行できることを確認）
- [ ] Docker Desktop の商用ライセンス要否（社内で要確認、上部の注記参照）
- [ ] データセットの具体的な運び方（USB か社内ストレージか等、手順3）
- [ ] 長時間学習を back ground で回す運用（`docker run -d` + ログの出し先など）は
      未整備。まずは前面で1回通すところまでを想定した手順

## 関連

- `.devcontainer/Dockerfile` — ビルド環境の定義そのもの（この手順の元ネタ）
- `docs/issues/gpu-support.md` — `device = cuda:0` / GPU 判定まわり
- `docs/issues/grpc-layer.md` — `ai_engine_app --serve` は gRPC サーバー起動。
  今回の学習実行とは別モード

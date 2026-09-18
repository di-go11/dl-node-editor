# 自前 GPU マシン(Windows Server 2022)で学習を動かす手順

対象: Windows Server 2022、NVIDIA GPU。Docker は **Docker Desktop**（WSL2 バックエンド）
経由で使う。**作業は WSL ではなく PowerShell で完結させる**（Docker Desktop の
`docker` コマンドは PowerShell からも使えるため）。インターネット到達可。
SSH 不可（外部からこのサーバーへの inbound）のため、**この手順は現地
（サーバーのコンソール/RDP）で実行する**前提。

**社内のライセンス方針を確認すること**: Docker Desktop は組織規模によって
有償サブスクリプションが必要な場合がある（Docker Subscription Service Agreement）。
商用サーバーでの継続利用前に確認してください。

現状の `.devcontainer/Dockerfile` はビルドツールチェーンだけを持つ「土台」イメージで、
リポジトリ本体は `docker-compose.yml` が bind mount で流し込む構成（イメージに
ソースを COPY しない）。この手順もその構成をそのまま踏襲する。

---

## 0〜1. 前提チェック・GPU 疎通確認（完了済み）

PowerShell で：

```powershell
# Docker Desktop 側のエンジンに切り替える(WSL側とは別管理なので、この
# PowerShell セッションでも設定が要る)
docker context use desktop-linux

# 疎通確認
docker run --rm hello-world

# GPU が使えるか確認
docker run --rm --gpus all nvidia/cuda:12.6.2-base-ubuntu22.04 nvidia-smi
```

GPU の情報が表示されるところまで確認済み。`nvidia-container-toolkit` の
インストールは Docker Desktop 側が内部で処理するため**不要**。

---

## 2. SSH 鍵と Deploy key（設定済み）

- PowerShell（Windows OpenSSH）で鍵を作成し、GitHub の当該リポジトリの
  **Deploy keys** に公開鍵を登録済み
- カスタムファイル名で作成したため、`$env:USERPROFILE\.ssh\config` に
  以下を追記して自動的に使われるようにしてある：
  ```
  Host github.com
      IdentityFile ~/.ssh/<作成したファイル名>
  ```
- `ssh -T git@github.com` で `Hi HT-lab-git/robust-object-detection! ...` の
  認証成功メッセージを確認済み

---

## 3. リポジトリを取得

`feat/gRPC-function` は `main` にマージ済み（SegNet 対応含む）。`main` を使う。
Deploy key は SSH 経由のみ有効なので、**SSH URL** で clone する（`https://` ではない）。

```powershell
git clone git@github.com:HT-lab-git/robust-object-detection.git
cd robust-object-detection
```

---

## 4. データセットを持っていく

`dataset/` は `.gitignore` 対象なので `git clone` では来ない。**SSH(inbound)が
使えないため、git 以外の方法で運ぶ必要がある**（USB メモリ／社内共有ストレージ／
クラウドストレージ経由でのダウンロード等）。

持っていった後、リポジトリの以下に置く：

```
robust-object-detection\apps\backend\ai-engine\dataset\train\
  ├── ImageSets\
  ├── JPEGImages\
  ├── SegmentationClass\
  ├── SegmentationClassP\
  ├── SegmentationObject\
  └── labelmap.txt
```

（今の devcontainer の `dataset/train/` と同じ中身をそのままコピーすればよい）

---

## 5. `.config` を確認する

`apps/backend/ai-engine/.config` のパスは**コンテナ内部から見えるパス**なので、
Windows 側のパスに書き換える必要は無い（手順7で bind mount するとき、
ホスト側のリポジトリをコンテナ内 `/workspaces` にマウントするため、
中身は devcontainer と同じ配置になる）。

```ini
dataset_path = /workspaces/apps/backend/ai-engine/dataset/train
output_dir   = /workspaces/apps/backend/ai-engine/models
device       = cuda:0
model_architecture = SegNet
```

そのままで動くはず。念のため中身を確認だけしておく。

---

## 6. 土台イメージをビルド

PowerShell で、`robust-object-detection` の直下から：

```powershell
docker build -t ai-engine:latest -f .devcontainer/Dockerfile .devcontainer
```

libtorch(CUDA 12.6 版, 約2GB)のダウンロードが走るので少し時間がかかる。

---

## 7. コンテナを起動してビルド & 学習実行

`docker-compose.yml` の `command: sleep` は開発用の待機なので、ここでは
直接学習コマンドを実行する形にする。PowerShell のカレントディレクトリを
`${PWD}` で渡す（Docker Desktop が Windows パス → コンテナ内パスの変換を
自動でやってくれる）。

```powershell
docker run --rm --gpus all `
  -v "${PWD}:/workspaces" `
  -w /workspaces/apps/backend/ai-engine `
  ai-engine:latest `
  bash -c "cmake -S . -B build && cmake --build build -j2 --target ai_engine_app && ./build/ai_engine_app"
```

（PowerShell の行継続は `` ` ``（バッククォート）。1行にまとめて書いても良い）

- `--gpus all`: GPU をコンテナに渡す
- `-v "${PWD}:/workspaces"`: リポジトリ全体を bind mount（`.config` の
  パスと一致させる）
- `-j2`: このプロジェクトの既定方針どおりビルド並列度を抑える
  （メモリ不足で落ちるのを防ぐ。マシンのメモリに余裕があれば上げてよい）
- `bash -c "..."` の中身はコンテナ（Linux）の中で実行されるので、
  ホストが Windows でもそのまま Linux のコマンドで良い

学習ログが標準出力に流れ、`models/model_best.pt` / `model_last.pt` が
リポジトリ内に生成される（bind mount なのでホスト側にもそのまま残る）。

### 繰り返し実行する場合

`cmake -S . -B build` は初回だけでよい。2回目以降はビルド済みの `build/`
がホスト側に残っているので：

```powershell
docker run --rm --gpus all `
  -v "${PWD}:/workspaces" `
  -w /workspaces/apps/backend/ai-engine `
  ai-engine:latest `
  ./build/ai_engine_app
```

---

## この手順で解決できていない/確認が必要な点

- [x] `feat/gRPC-function` を `main` にマージするかどうか → マージ済み
- [x] Docker Desktop / WSL2 Engine 単体 のどちらを使うか →
      **Docker Desktop（`desktop-linux` コンテキスト）を使う**で確定
- [x] GitHub 認証方式 → **Deploy key（SSH）**で確定。設定・疎通確認済み
- [x] PowerShell / WSL のどちらで作業を統一するか → **PowerShell** で確定
- [ ] Docker Desktop の商用ライセンス要否（社内で要確認、上部の注記参照）
- [ ] データセットの具体的な運び方（USB か社内ストレージか等、手順4）
- [ ] 長時間学習を back ground で回す運用（`docker run -d` + ログの出し先など）は
      未整備。まずは前面で1回通すところまでを想定した手順

## 関連

- `.devcontainer/Dockerfile` — ビルド環境の定義そのもの（この手順の元ネタ）
- `docs/issues/gpu-support.md` — `device = cuda:0` / GPU 判定まわり
- `docs/issues/grpc-layer.md` — `ai_engine_app --serve` は gRPC サーバー起動。
  今回の学習実行とは別モード

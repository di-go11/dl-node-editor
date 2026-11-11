# feat: CI/CD の本格化(マルチブランチ・機能別 agent・SSH 経由の自動デプロイ)

C++ だけを CI している今の Jenkins を、全コンポーネントの CI と、本番への自動デプロイ(CD)まで広げる計画。
Jenkins 基盤そのものの経緯は [ci-jenkins.md](../../apps/backend/ai-engine/docs/issues/ci-jenkins.md) を参照。

実装はユーザーが行う。この文書は計画と確認手順だけを持つ。

## 現状(2026-11-11)

- 本番構成(`.deploy/compose.prod.yml`、各 Dockerfile の `runtime` ステージ、nginx)は完成し、サーバー上で手動デプロイの動作を確認済み
- Jenkins は `Pipeline script from SCM` の単一ジョブで、`*/main` だけを `pollSCM` で監視している
- agent は `ci-agent`(C++、ラベル `cpp-cpu`。機能別の `ai-engine` に変える)の 1 つだけ。Rust と Node は CI されていない
- Jenkins の controller / agent の compose・casc.yaml・plugins.txt・.env はリポジトリ外(サーバー上)にある

## 決定事項

| 項目 | 決定 | 理由 |
|---|---|---|
| CD の方式 | **SSH の強制コマンド**。agent はホストへ SSH し、`/opt/deploy/deploy.sh` しか実行できない鍵でデプロイを依頼する | `docker.sock` を agent に渡さない方針([ci-jenkins.md](../../apps/backend/ai-engine/docs/issues/ci-jenkins.md))を守るため。agent が乗っ取られても「origin/release で再デプロイ」しかできない |
| CI の範囲 | C++ に加えて Rust と フロントも CI する。**機能(コンポーネント)ごとに agent を分ける**(ラベル `ai-engine` / `api` / `web`) | 既存の方針「agent は開発用 Dockerfile を土台にして、開発環境と CI 環境を一致させる」を各コンポーネントに広げる。ラベル名は Dockerfile(`Dockerfile.ai-engine` / `.api` / `.web`)と揃える(2026-11-11、言語名から変更) |
| ジョブ定義 | **casc.yaml の Job DSL**(`jobs:`)で Multibranch ジョブを定義する | GUI で作らず、controller を作り直しても再現できるようにする |
| ブランチ | **Multibranch Pipeline に移行**し、`main` / `release` / `feat/*` を見る。`feat/*` と `main` は CI だけ、**`release` は CI の後にデプロイ** | `feat/*` も検証することにした(2026-11-11)。単一ジョブの Branch Specifier に `*/feat/*` を足す方法もあるが、ブランチごとに履歴が分かれず、「特定ブランチのときだけデプロイ」の条件も自前で書く必要があるため Multibranch にする |
| デプロイするブランチ | **`release`**。main は開発の統合先で、本番に出すときに main → release をマージする(2026-11-11、main から変更) | 研究室サーバーでは他の人の学習も動くため、本番に出すタイミングを自分で選べるようにする。複数の変更をまとめて出せ、本番だけを前のコミットに戻すこともできる。既存の運用(`Merge branch 'main' into release`)とも一致する |

## 完成形

```
GitHub ──(定期スキャン、main / release / feat/*)──→ Jenkins controller (Multibranch)
                               │
         ┌─────────────────────┼─────────────────────┐   ← 並列
         ▼                     ▼                     ▼
   ai-engine agent        api agent             web agent
   cmake / ctest -L cpu   fmt / clippy / test   npm ci / verify / build
         └─────────────────────┼─────────────────────┘
                               ▼  (release で、CI が全部成功したら)
                        Deploy ステージ (label 'deploy')
                               │  ssh deploy@ホスト
                               ▼
                 ホスト: /opt/deploy/deploy.sh
                   学習中なら中止 → git checkout origin/release
                   → compose up -d --build → ヘルスチェック → image prune
```

## 作業の順番

各作業は単独で動作確認できるように切ってある。前の作業が確認できてから次に進む。

| 作業 | 内容 | 確認できること |
|---|---|---|
| 0 | 既存 agent の Dockerfile 参照を直す | agent をリビルドしても今のジョブが動く |
| 1 | Multibranch へ移行(C++ だけのまま) | `feat/*` / `main` / `release` がそれぞれ別のジョブとしてビルドされる |
| 2 | CD(deploy ユーザー・deploy.sh・SSH・Deploy ステージ) | `release` にマージすると本番が更新され、`main` と `feat/*` ではデプロイされない |
| 3 | api / web agent を追加し、Jenkinsfile を機能別ステージにする | 3 コンポーネントの CI が並列で回る |
| 4 | 通知([ci-jenkins.md](../../apps/backend/ai-engine/docs/issues/ci-jenkins.md) の Phase 3) | 失敗と復旧のときだけ通知が届く |

CD(作業 2)を agent の追加(作業 3)より先にするのは、早く「push → 本番」の一周を通すため。
作業 3 までの間に Rust やフロントが壊れていても、`compose up --build` のイメージビルドで失敗するので
(web は `tsc -b`、api は `cargo build`)、コンテナは作り直されず、壊れたまま本番に出ることはない。

---

## 作業 0: 既存 agent の Dockerfile 参照を直す

> **完了(2026-11-11)**

`.devcontainer/Dockerfile` は `Dockerfile.ai-engine` に改名した(コミット 3ff0918)。
サーバー上の Jenkins 用 compose の `jenkins-agent` は `dockerfile: Dockerfile` のままなので、次にリビルドすると失敗する。

- [ ] `jenkins-agent.build.dockerfile` を `Dockerfile.ai-engine` にする(`target: ci-agent` はそのまま)
- [ ] agent のビルド元のクローン(`ObjectDetection/robust-object-detection`)を、改名を含むコミットまで pull する

確認: `docker compose build jenkins-agent && docker compose up -d jenkins-agent` の後、今のジョブを手動実行して通る。

## 作業 1: Multibranch Pipeline へ移行

> **完了(2026-11-11)**: Job DSL で `dl-node-editor` ジョブを作成。agent は `ai-engine-agent`(ラベル `ai-engine`)。main / release / feat/* のビルドを確認済み。

> 経緯(2026-11-11): 一度は「main だけで十分」として保留にしたが、`feat/*` も見ることにして再開した。

### 手順

1. [ ] plugins.txt に `job-dsl` を追加し、`workflow-multibranch` / `branch-api` / `cloudbees-folder` があるか確認する(`workflow-aggregator` に含まれていれば追加不要)。プラグインはイメージに焼き込むので controller を build し直す
2. [ ] casc.yaml のトップレベル(`jenkins:` と同じ階層)に `jobs:` を足し、Job DSL で Multibranch ジョブを定義する。YAML は `|`(改行を保持)で書く
   - `multibranchPipelineJob('dl-node-editor')`
   - Branch Source: `git { id('dl-node-editor'); remote('git@github.com:HT-lab-git/dl-node-editor'); credentialsId('github-deploy-key') }`。`id` は固定(変えるとブランチのジョブと履歴が作り直される)
   - traits: `gitBranchDiscovery()` と `headWildcardFilter { includes('main release feat/*'); excludes('') }`。traits がないとブランチが検出されない。パターンは必ず文字列で書く(`feat/*` を裸で書くと `/*` がコメントになる)
   - `triggers { periodicFolderTrigger { interval('1h') } }`: 時間帯は指定できないが、スキャンは `git ls-remote` 相当で軽く、ビルドはコミットがあるときだけなので 24 時間で問題ない(9〜22 時の制限は負荷対策だったため不要と判断)
   - `orphanedItemStrategy { discardOldItems { numToKeep(10) } }`: 削除されたブランチのジョブを破棄
   - 正確な構文は `http://<jenkins>/plugin/job-dsl/api-viewer/index.html`(インストール済みプラグインに合わせた API)で確認する
   - JCasC は再起動・Reload のたびにこの定義を適用し直すので、ジョブの変更は GUI ではなく casc.yaml で行う
3. [ ] Jenkinsfile の `triggers { pollSCM(...) }` を消す。Multibranch では定期スキャンが新しいコミットを検出してビルドを起動するので、二重になる
4. [ ] `stage('Checkout')` を消す。Multibranch(と Declarative Pipeline)は各 agent で自動的に `checkout scm` する。残すと 2 回 checkout する
5. [ ] 旧ジョブ(`*/main` の単一ジョブ)を無効化する。並行して動くと agent を取り合う

### 注意

- `when { branch 'release' }` は Multibranch でだけ使える。作業 2 の Deploy ステージはこれを前提にする
- Multibranch は GitHub 上の**各ブランチの** Jenkinsfile を使う。Jenkinsfile を変えたら main に入れ、release にもマージする
- `disableConcurrentBuilds()` は「同じブランチのジョブの同時実行」を防ぐだけ。別ブランチ同士は agent の `numExecutors: 1` によってキューで順番待ちになる
- Jenkinsfile の `agent { label ... }` は casc.yaml の `labelString` と一致させる。一致しないとビルドが「待機中」のまま止まる。作業 1 の時点では C++ の agent を `ai-engine` にする(下の「ラベルの付け方」)

確認: `feat/SQL` / `main` / `release` のそれぞれでジョブが自動作成され、C++ のテストが通る。

### ラベルの付け方(機能別)

| agent(node 名) | labelString | 用途 |
|---|---|---|
| 既存の C++ agent | `ai-engine deploy` | C++ の CI。Deploy ステージもここで動かす(`openssh-client` 入り) |
| api agent(作業 3) | `api` | Rust の CI |
| web agent(作業 3) | `web` | フロントの CI |

- ラベルはスペース区切りで複数付けられる。Jenkinsfile では `label 'ai-engine'` や `label 'deploy'` のように、役割の名前で agent を指定する。Deploy はどのコンポーネントにも属さないので、専用のラベル `deploy` にしておくと、後で別の agent に移すときに Jenkinsfile を変えずに済む
- 将来 GPU テスト(ci-jenkins.md の Phase 4)を足すときは、`ai-engine cpu` / `ai-engine gpu` のようにラベルを増やし、`label 'ai-engine && gpu'` のような式で指定する
- **node 名(`name:`)を変えると agent の secret が変わる**。JNLP の secret は node 名から作られるため。ラベル(`labelString`)だけ変えるなら `.env` の `JENKINS_AGENT_NAME` / `JENKINS_SECRET` はそのままでよい

## 作業 2: CD(SSH の強制コマンドで自動デプロイ)

### 2-1. ホスト側

1. [ ] デプロイ専用ユーザー `deploy` を作る。パスワードは設定しない(鍵でしかログインできない)
   - docker グループに入れる(`docker compose` のため)。docker グループは root 相当だが、ログイン手段が強制コマンド付きの鍵だけなので任意のコマンドは実行できない
   - より厳しくするなら、docker グループに入れずに sudoers で `deploy ALL=(root) NOPASSWD: /opt/deploy/deploy.sh` だけを許可し、強制コマンドを `sudo /opt/deploy/deploy.sh` にする
2. [ ] デプロイ専用のクローンを作る(例: `/srv/robust-object-detection`、所有者 `deploy`)
   - 開発用クローン(agent のビルド元)とは分ける。未コミットの変更が本番に混ざらないように
   - GitHub には読み取り専用の Deploy Key で接続する
   - 今の本番データ(`.deploy/data/` の weights / datasets / api-data)をこのクローンの `.deploy/data/` に移す。`.gitignore` の対象なので checkout で消えない
   - 移した後、旧クローン側の compose を `down` してから新クローンで `up` する(同じ compose プロジェクト名 `easy-deeplearning-creator` なので、二重には立たないが、どちらのディレクトリのデータを使っているかを混同しないように)
3. [ ] `/opt/deploy/deploy.sh` を作る。所有者 root、`deploy` からは書き込めない権限(`755`)にする
4. [ ] `~deploy/.ssh/authorized_keys` に強制コマンド付きで公開鍵を登録する

### 2-2. deploy.sh がやること

上から順に。どこかで失敗したら `set -euo pipefail` でそこで止まり、終了コードが非 0 になって Jenkins のステージが失敗する。

| 順 | 処理 | ポイント |
|---|---|---|
| 1 | 多重実行の防止 | `flock -n` でロックを取る。取れなければ失敗 |
| 2 | 学習中なら中止 | ホストから DB を読む: `sqlite3 .deploy/data/api-data/training.db "SELECT count(*) FROM training_runs WHERE status = 'running'"` が 0 でなければ失敗。ホストに `sqlite3` が要る |
| 3 | ソースの更新 | `git fetch origin` → `git checkout --detach origin/release`。参照先は固定し、外から指定させない |
| 4 | ビルドと起動 | `docker compose -f .deploy/compose.prod.yml up -d --build`。イメージのビルドに失敗した場合、コンテナは作り直されない |
| 5 | ヘルスチェック | `curl -fsS --retry 10 --retry-delay 3 http://127.0.0.1:25812/api/v1/capabilities`。capabilities は nginx → Rust → C++ を通るので全体の疎通確認になる |
| 6 | 古いイメージの削除 | `docker image prune -f`。ai-engine のイメージは数 GB あり、デプロイのたびに古いものが残ってディスクを埋めるため |
| 7 | 結果の表示 | デプロイしたコミット(`git rev-parse --short HEAD`)を echo する。Jenkins のログに残る |

- **`$SSH_ORIGINAL_COMMAND` は使わない**。ssh で送られた文字列が入る変数で、使わなければ外から何かを注入される余地がない
- **2 の判定について**: DB の `running` は、Rust が落ちたときに残ることがある(`backend-db-remaining.md` 参照)。その場合はデプロイが止まるが、安全側の誤りなので許容する。止まったら DB の状態を確認して手で直す
- **2 をもっと緩めたい場合**: `up -d --build` は**イメージが変わったコンテナだけ**を作り直すので、C++ を変えていなければ学習は止まらない。ただ、それを事前に判定するのは複雑なので、当面は一律に中止する

### 2-3. authorized_keys

```
command="/opt/deploy/deploy.sh",restrict,from="<Jenkins ネットワークのサブネット>" ssh-ed25519 AAAA... jenkins-deploy
```

- `restrict`: ポート転送・エージェント転送・pty などをすべて禁止する
- `from=`: agent コンテナがホストに接続したときの送信元。`docker network inspect <jenkins のネットワーク名>` の Subnet で確認する
- 鍵はこの用途専用に新しく作る(`ssh-keygen -t ed25519 -C jenkins-deploy`)。パスフレーズなし(Jenkins が使うため)

### 2-4. Jenkins 側

1. [ ] 秘密鍵を Credentials に「SSH Username with private key」(ユーザー名 `deploy`)で登録する
2. [ ] ホストの公開鍵(`ssh-keyscan <ホスト>` の結果)を「Secret file」で登録し、`known_hosts` として使う。`StrictHostKeyChecking=no` は使わない
3. [ ] plugins.txt に `credentials-binding`(`withCredentials` に必要)と `ssh-credentials` があるか確認する
4. [ ] Jenkinsfile に Deploy ステージを追加する
   - `when { branch 'release'; beforeAgent true }`: `main` と `feat/*` ではデプロイしない。`beforeAgent true` で、release 以外では agent も確保しない(`when { branch }` は Multibranch でだけ効くので、作業 1 が前提)
   - 前のステージ(テスト)が失敗すると Deploy は実行されない
   - agent は `label 'deploy'`(C++ の `ci-agent` に付けるラベル。`openssh-client` が入っている)
   - `withCredentials([sshUserPrivateKey(...), file(...)])` で鍵と known_hosts を受け取り、`ssh -i "$KEY" -o UserKnownHostsFile="$KNOWN_HOSTS" deploy@<ホスト>` を実行する
   - **タイムアウトを延ばす**: 今の `timeout(30 分)` はパイプライン全体にかかる。C++ を変えたときの `docker build` は数十分かかるので、Deploy ステージは個別に長めの timeout を付けるか、全体の値を見直す
5. [ ] 接続先のホストアドレス: agent コンテナから見たホスト。LAN の IP(`192.168.11.20`)か、Jenkins ネットワークのゲートウェイ IP。sshd がそのアドレスで待ち受けているか確認する

### 2-5. 確認の手順(切り分けのため 3 段階)

1. [ ] ホストで `sudo -u deploy /opt/deploy/deploy.sh` → スクリプト単体で動く
2. [ ] 手元から `ssh -i <鍵> deploy@<ホスト>` → スクリプトが実行される。さらに `ssh -i <鍵> deploy@<ホスト> ls` で、`ls` ではなくスクリプトが実行されること(強制コマンドが効いていること)を確かめる
3. [ ] main → release をマージして push → Jenkins の Deploy ステージから本番が更新される。main への push ではデプロイされないこと、学習中に release を push するとデプロイが中止されることも確かめる

### 既知の制約

- CI でテストしたバイナリ(agent でビルド)と本番のイメージ(ホストで `docker build`)は、同じコミットからの別ビルド。研究用途では問題にしない
- `deploy` ユーザーのシェルが別の経路で取られると、docker グループ経由で root 相当になる。気になるなら sudoers 方式にする

## 作業 3: api / web agent を追加し、機能別ステージにする

### 3-1. agent のイメージ(各 Dockerfile に `ci-agent` ステージを足す)

`Dockerfile.ai-engine` の `ci-agent` ステージと同じ構成にする: `FROM dev` → JRE と `openssh-client`・`curl` を追加 → `jenkins` ユーザー → `jenkins-agent-entrypoint.sh`。

- [ ] `Dockerfile.api` に `ci-agent` ステージ(ラベル `api`)
- [ ] `Dockerfile.web` に `ci-agent` ステージ(ラベル `web`)

注意点:

- **Java のバージョン**: controller(JDK 21)と合わせる。`Dockerfile.api` / `Dockerfile.web` のベースは Debian bookworm で、標準リポジトリでは `openjdk-21` が入らない可能性が高い。
  `COPY --from=eclipse-temurin:21-jre /opt/java/openjdk /opt/java/openjdk` で JRE だけをコピーし、`PATH` に足すのが確実
- **Rust の書き込み先(ccache で起きたのと同じ問題)**: rust イメージの `CARGO_HOME=/usr/local/cargo` は root 所有なので、`jenkins` ユーザーの cargo はレジストリをダウンロードできない。
  `ENV CARGO_HOME=/home/jenkins/.cargo` に変え、`PATH` に `/usr/local/cargo/bin`(rustc・cargo 本体)が残っていることを確かめる
- **`ci-agent` ステージを足しても、開発用 compose には影響しない**(`target: dev` を明示済み)
- **ビルドコンテキスト**: Jenkins 用 compose からは `context: <クローン>/.devcontainer` でビルドする(既存の C++ agent と同じ)。`ci-agent` ステージは `apps/` を COPY しないので、これで足りる

### 3-2. Jenkins 側(サーバー上のファイル)

- [ ] casc.yaml の `nodes` に `api-agent`(ラベル `api`)と `web-agent`(ラベル `web`)を追加する。`numExecutors: 1`
- [ ] Jenkins 用 compose に `jenkins-agent-api` / `jenkins-agent-web` を追加する
  - `.env` に agent ごとの名前と secret を足す(`JENKINS_AGENT_NAME_API` / `JENKINS_SECRET_API` など)
  - キャッシュ用の名前付きボリューム: api は `CARGO_HOME`(レジストリ)と `CARGO_TARGET_DIR`(ビルド成果物。これがないと毎回フルビルドになる)、web は `~/.npm`
  - `deploy.resources.limits` で CPU とメモリを制限する。3 つの agent が並列で動くので、他の利用者の学習を邪魔しない範囲に

### 3-3. Jenkinsfile

- [ ] トップレベルを `agent none` にし、ステージごとに agent を指定する
- [ ] CI の 3 ステージを `parallel` でまとめる

| ステージ | agent | 実行するもの | 作業ディレクトリ |
|---|---|---|---|
| C++ | `ai-engine` | `cmake -S . -B build -G Ninja` → `cmake --build build -j2` → `ctest --test-dir build --output-on-failure -j2 -L cpu` | `apps/backend/ai-engine` |
| Rust | `api` | `cargo fmt --check` → `cargo clippy --all-targets -- -D warnings` → `cargo test` | `apps/backend/api` |
| Web | `web` | `npm ci` → `npm run verify` → `npm run build` | `apps/frontend` |
| Deploy | `deploy` | 作業 2 のとおり(parallel の後に置く。`when { branch 'release' }`) | - |

- Rust の `build.rs` は `../../../proto` を、フロントのテストは `../../../backend/ai-engine/modelconfigs/...` を読む。どちらもリポジトリ全体が checkout されるので問題ない
- sqlx はコンパイル時チェックのマクロ(`query!`)を使っていないので、Rust の CI に DB は要らない
- `npm run verify` は `tsc -b` まで含むが `vite build` は含まないので、`npm run build` も実行する(本番イメージのビルドと同じことを先に確かめる)
- **初回は clippy や fmt で落ちる可能性がある**。まず `-D warnings` なしで回し、指摘を直してから厳しくする、でもよい
- 並列にすると、3 つの agent が同時に CPU を使う。サーバーの負荷が気になるなら `parallel` をやめて順番に実行する

確認: `feat/*` に push して、3 ステージが並列で動き、それぞれ成功・失敗が独立に表示される(Deploy はスキップされる)。release ではどれか 1 つでも失敗すると Deploy に進まない。

## 作業 4: 通知

[ci-jenkins.md](../../apps/backend/ai-engine/docs/issues/ci-jenkins.md) の Phase 3 のとおり。CD が入ったので、**デプロイの成功・失敗も通知の対象**にする(特に「学習中のため中止」は人が見に行く必要がある)。

## 未決事項

- [ ] 本番データの移動先(作業 2 の `/srv/robust-object-detection` でよいか)と、データセットの置き方(クローン内か、別の場所をマウントするか)
- [ ] api / web の agent に割り当てる CPU・メモリの上限
- [ ] Jenkins 用ファイル(compose / casc.yaml / plugins.txt)をリポジトリ(`ci/`)で管理するか。今はサーバー上にだけある。管理する場合 `.env` は Git に入れない

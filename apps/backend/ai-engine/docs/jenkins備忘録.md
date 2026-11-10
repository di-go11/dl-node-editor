# jenkins備忘録

## jenkinsサーバー(dockerを使って)を実装するには基礎として次の5つのファイルを実装する必要がある

1. Dockerfile.jenskins(.jenkinsはなくていいが入れておいたほう後々わかりやすくなる)
2. docker-compose.yml
3. casc.yaml(jenkinsサーバーの初期設定をスクリプト化できる。)
4. plugins.txt(gitやサードパーティapiなど必要なプラグインを宣言する)
5. .env(admin情報やagentコンテナとcontrollerコンテナが接続する際に必要となる暗号鍵やagent名を登録できる)
6. jenkins-agent-entrypoint.sh(jenkins agentを登録するため)

### 各ファイルの説明

#### Dockerfile.jenkins

```Dockerfile
# Jenkins controller 用 devcontainer
# ベースイメージ: 公式 LTS(Debian bookworm系) + JDK21
FROM jenkins/jenkins:2.568.3-lts-jdk21

# プラグインインストール等、root権限が必要な初期設定のため一時的に切り替える
USER root

# 追加ツールは最小限に留める(学内サーバー限定運用のため、不要な攻撃対象面を増やさない)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# プラグインのバージョンを固定し、再現可能なイメージにする
# (plugins.txt はリポジトリ側で管理し、定期的にバージョンを見直す)
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt

# Configuration as Code (JCasC) で管理者・ジョブ設定を再現可能にし、
# UIでの手動設定を避ける
ENV CASC_JENKINS_CONFIG=/var/jenkins_home/casc.yaml

# セットアップウィザードを無効化し、casc.yamlの設定内容だけで起動を完結させる
ENV JAVA_OPTS="-Djenkins.install.runSetupWizard=false"

# 秘密情報(通知用認証情報など)はCredentialsストア経由で注入する想定。
# このDockerfile / casc.yaml には直書きしない

# jenkins/jenkins公式イメージのデフォルト実行ユーザーに戻す
USER jenkins

# UI(8080)は学内 or 127.0.0.1 + SSHポートフォワードのみで公開する方針のため、
# ここではポート宣言のみに留め、公開範囲はdocker-compose側のbind先で制御する
EXPOSE 8080
# agent(JNLP/inbound-agent)接続用ポート
EXPOSE 50000
```

#### docker-compose.yml

```yaml
services:
  jenkins-controller:
    build:
      context: .
      dockerfile: Dockerfile.jenkins
    environment:
      JENKINS_ADMIN_ID: ${JENKINS_ADMIN_ID}
      JENKINS_ADMIN_PASSWORD: ${JENKINS_ADMIN_PASSWORD}
    volumes:
      - ../jenkins-home:/var/jenkins_home
      - ./casc.yaml:/var/jenkins_home/casc.yaml:ro
    ports:
      - "192.168.11.20:8082:8080" # ホストPCにてアドレスを指定して解放.外部からのアクセス可能
      - "127.0.0.1:8082:8080" # localhostにて解放. 外部からのアクセス不可
    networks:
      - jenkins-net
  jenkins-agent:
    build:
      context: ../../ObjectDetection/robust-object-detection/.devcontainer
      dockerfile: Dockerfile.ai-engine
      target: ci-agent #devステージではなく、ci-agentステージがビルドされる
    volumes:
      - jenkins-ccache:/home/jenkins/.ccache  #専用ボリューム
    environment:
      # controller側でagentを登録した際に発行されるsecretを渡す。
      # Gitにはコミットせず、.env(gitignore対象)またはJenkins Credentialsストア経由で注入する
      JENKINS_URL: http://jenkins-controller:8080
      JENKINS_AGENT_NAME: ${JENKINS_AGENT_NAME}
      JENKINS_SECRET: ${JENKINS_SECRET}
    networks:
      - jenkins-net
    depends_on:
      - jenkins-controller
    # 現段階(2026/9/24)ではCPUのみのテスト範囲とする。
    restart: unless-stopped

networks:
  jenkins-net:

volumes:
  jenkins-ccache:
```

#### casc.yaml

```yaml
jenkins:
  systemMessage: "robust-object-detection CI (self-hosted)"
  numExecutors: 0        # controller自身ではビルドを実行しない(agentにやらせる)
  slaveAgentPort: 50000  # 前回話したagent接続用ポートの固定化

  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: "${JENKINS_ADMIN_ID}"
          password: "${JENKINS_ADMIN_PASSWORD}"

  authorizationStrategy:
    globalMatrix:
      permissions:
        - "Overall/Administer:${JENKINS_ADMIN_ID}"
  nodes:
    - permanent:
        name: "cpp-agent"
        remoteFS: "/home/jenkins/agent"
        numExecutors: 1
        labelString: "cpp-cpu"       # Jenkinsfile側で agent { label 'cpp-cpu' } のように参照する
        mode: NORMAL
        launcher:
          jnlp:
            workDirSettings:
              disabled: false
        retentionStrategy: "always"
```

#### .env

```.env
# Jenkins controller 管理者アカウント(casc.yamlのsecurityRealmで参照)
JENKINS_ADMIN_ID=admin
JENKINS_ADMIN_PASSWORD=<jenkinsサーバーの管理者パスワード(ホストのパスワードではない)>

# jenkins-agentコンテナがcontrollerに接続する際に使う
JENKINS_AGENT_NAME=<コンテナ宣言時にいれたagent名>
JENKINS_SECRET=<jenkinsのagentのタブから取得できる暗号鍵>
```

#### jenkins-agent-entryppoint.sh

```sh
#!/bin/bash
set -euo pipefail

: "${JENKINS_URL:?JENKINS_URL is required}"
: "${JENKINS_AGENT_NAME:?JENKINS_AGENT_NAME is required}"
: "${JENKINS_SECRET:?JENKINS_SECRET is required}"

curl -fsSL -o /home/jenkins/agent/agent.jar "${JENKINS_URL%/}/jnlpJars/agent.jar"

exec java -jar /home/jenkins/agent/agent.jar \
    -url "${JENKINS_URL}" \
    -name "${JENKINS_AGENT_NAME}" \
    -secret "${JENKINS_SECRET}" \
    -workDir "/home/jenkins/agent"
```

## jenkinsの動作プラン

jenkinsの各agentの動作プランについては、GUIで設定可能だが、スクリプト化させることもできる。
スクリプトとして使われるファイル形式が`Jenkinsfile`である。

今回は以下のように作成した。

```Jenkinsfile
pipeline{
    agent{label 'cpp-cpu'}
    options{
        disableConcurrentBuilds() // 同時実行を一つに制限
        timeout(time: 30, unit: 'MINUTES') //30分でタイムアウト
        buildDiscarder(logRotator(numToKeepStr: '20')) // 直近20回分だけ残す
    }
    triggers{
        pollSCM('TZ=Asia/Tokyo\nH/30 9-22 * * * ') //TZ=を書くとタイムゾーンを指定できる。\nで改行させることで1行目タイムゾーン,2行目cron式になる。
    }
    stages{
        stage('Checkout'){
            steps {
                checkout scm // Jenkinsのジョブ設定に紐づいたリポジトリをcloneする組み込みステップ
            }
        }
        stage('Configure'){
            steps{
                dir('apps/backend/ai-engine'){
                sh 'cmake -S . -B build -G Ninja' // シェルコマンドでC++のconfigure setting
                }
            }
        }
        stage('Build'){
            steps{
                dir('apps/backend/ai-engine'){
                    sh 'cmake --build build -j2'
                }
            }
        }
        stage('Test'){
            steps{
                dir('apps/backend/ai-engine'){
                    sh 'ctest --test-dir build --output-on-failure -j2 -L cpu '
                }
            }
        }
    }
}
```

### 各キーワードブロックの説明

- `pipeline`: 動作プランの最外殻となる。必ずこれの中に定義していく。
- `agent`: 先に作成したagentを呼び出す.`agent (label 'cpp-cpu')`では、label`cpp-cpu`を持ったagentを使用することを意味する。
- `option`:実行時の制約を決める。
- `trigger`: 動作プランの実行条件を決める。
  - `pollSCM`:ポーリングの時間間隔を指定する。
    ```text
    pollSCM('H/15 * * * *')   // 15分おき(分の範囲0-59を15刻みで)
    pollSCM('H H/4 * * *')    // 4時間おき(時の範囲0-23を4刻みで)
    pollSCM('H/5 6-21 * * *') // 5時間起き(6時から21時の間だけ)
    ```
- `stages`: 作業の大枠
  - `stage`:作業の単位を示す
    - `steps`:作業中の動作(シェル実行など)を宣言する
        注意: shコマンドは各行ごと独立なため、`ch 'cd...'`のように書いてディレクトリを移動した後に実行処理を書いても意味がない.`dir()`で作業ディレクトリを変えたりする必要がある。

## トラブルシューティング

### 1. `Configure`ステージで `CUDA_ARCHITECTURES is empty` になる(原因は ccache の権限)

#### 症状

Pipelineの`Configure`ステージ(`cmake -S . -B build -G Ninja`)が失敗する。

```text
-- Found CUDA: /usr/local/cuda (found version "13.2")
-- The CUDA compiler identification is unknown
CMake Error ... CUDA_ARCHITECTURES is empty for target "cmTC_xxxx".
```

同じイメージ(`base`ステージ)の開発コンテナ(`ai-engine-dev`)では通るのに、Jenkinsのagentでだけ失敗する。

#### 原因の連鎖(表示されたエラーは「症状」で、本当の原因は別の場所にあった)

```text
① ccache が書き込めない(本当の原因)
   ↓
② nvcc が呼ぶ gcc(= ccache 経由)が失敗
   ↓
③ CMake が CUDA コンパイラを識別できない("identification is unknown")
   ↓
④ 使う GPU アーキテクチャを決められず "CUDA_ARCHITECTURES is empty"  ← 画面に出たエラー
```

1. `CMakeLists.txt`の`find_package(Torch REQUIRED)`が、libtorch(CUDAビルド)の設定内で`enable_language(CUDA)`を呼ぶ。
   CMakeは小さな`.cu`を`nvcc`でコンパイルして「どのコンパイラか」を確かめる(GPUが無くても、この確認は必要)。
2. `nvcc`はホスト側(CPU側)のC++コンパイルを、`PATH`から見つけた`gcc`に任せる。
3. `Dockerfile`の`ENV PATH="/usr/lib/ccache:${PATH}"`により、`PATH`先頭の`gcc`は本物ではなく`ccache`へのシンボリックリンク。
   つまり`nvcc`が呼ぶ`gcc`は`ccache`経由で動く。
4. `base`ステージの`CCACHE_DIR=/ccache`は、開発コンテナ(root)が作った`root`所有のボリューム。
   一方、Jenkinsのagentは非root(`jenkins`ユーザー)で動くため、`ccache`が一時ファイルを作れず異常終了する。

   ```text
   ccache: error: Failed to create temporary file for /ccache/tmp/...: Permission denied
   ```
5. `gcc`が失敗 → `nvcc`もエラー終了 → CMakeが識別に失敗 → アーキテクチャのデフォルトも決められず空になる。

#### なぜ他では起きなかったのか

- **開発コンテナ**: `root`で動くので、`/ccache`に書き込める。
- **agentでのC/C++コンパイラの確認**: ログ上は通っていた。コンパイルとリンクを1回のコマンドで行うため、
  `ccache`がキャッシュを使わず素通しした、と考えられる。`nvcc`が呼ぶ`gcc -c ...`(コンパイルのみ)だけが、
  キャッシュを使おうとして失敗した。

#### 調べ方

CMakeのconfigureエラーは、画面のエラーより**ログファイルの方に本当の理由が出る**。

```bash
# agent コンテナに jenkins ユーザーで入る
docker-compose exec -u jenkins jenkins-agent bash
cd /home/jenkins/agent/workspace/<ジョブ名>/apps/backend/ai-engine

# CMake の詳細ログ(CUDA 識別の失敗理由はここ)
grep -n -i -B3 -A15 "nvcc\|error" build/CMakeFiles/CMakeError.log | head -80

# 併せて、環境を確認する
which nvcc; nvcc --version    # nvcc が見つかるか
echo $PATH                     # PATH の先頭が /usr/lib/ccache になっているか
id; ls -ld /ccache             # 実行ユーザーと、キャッシュ置き場の所有者
```

ログに`ccache: error: Failed to create temporary file ... Permission denied`が出ていたことで、原因が確定した。

#### 対処

`jenkins`ユーザーが書き込めるccacheディレクトリを、**agent専用の名前付きボリューム**で用意した。

1. `.devcontainer/Dockerfile`の`ci-agent`ステージ

   ```dockerfile
   RUN useradd -m -d /home/jenkins jenkins \
       && mkdir -p /home/jenkins/agent /home/jenkins/.ccache \
       && chown -R jenkins:jenkins /home/jenkins

   ENV CCACHE_DIR=/home/jenkins/.ccache   # base の CCACHE_DIR=/ccache を上書き
   ```

2. `docker-compose.yml`(`jenkins-agent`)

   ```yaml
   volumes:
     - jenkins-ccache:/home/jenkins/.ccache   # 変更前: ccache-data:/ccache

   # ファイル末尾
   volumes:
     jenkins-ccache:
   ```

**なぜ専用ボリュームで権限が解決するのか**: 新しい名前付きボリュームは、空の状態で最初にマウントされるときに、
マウント先のイメージ内ディレクトリの中身と**所有者・権限がコピーされる**。イメージ内の`/home/jenkins/.ccache`は
`jenkins`所有なので、ボリュームも`jenkins`所有になる。以前の`ccache-data`は、rootの開発コンテナが先に作っていたため、
rootの所有者が残ったままだった。

確認:

```bash
docker-compose exec -u jenkins jenkins-agent bash -c 'echo $CCACHE_DIR; ls -ld $CCACHE_DIR'
# /home/jenkins/.ccache
# drwxr-xr-x 2 jenkins jenkins ... /home/jenkins/.ccache
```

#### トレードオフ

開発コンテナとCIでccacheを共有できなくなった。CIのキャッシュはagent側のボリュームに溜まるので、2回目以降のCIビルドを速くする
目的は満たせる。所有者(rootとjenkins)が混ざる問題を避けられるので、こちらの方が安定する。

#### 学び

- 表示されたエラーは症状で、原因は別の場所(今回は`ccache`)にあった。**CMakeの`CMakeError.log`まで見に行く**。
- 「開発環境では動くのにCIでは動かない」原因は、コードよりも**実行環境の差**(rootか非rootか、ボリュームの所有者)にあることが多い。
- 非rootで動かすコンテナでは、書き込むディレクトリ(キャッシュ、`HOME`など)の所有者を必ず確認する。

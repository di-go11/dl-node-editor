# jenkins備忘録

## jenkinsサーバー(dockerを使って)を実装するには基礎として次の5つのファイルを実装する必要がある

1. Dockerfile.jenskins(.jenkinsはなくていいが入れておいたほう後々わかりやすくなる)
2. docker-compose.yml
3. casc.yaml(jenkinsサーバーの初期設定をスクリプト化できる。)
4. plugins.txt(gitやサードパーティapiなど必要なプラグインを宣言する)
5. .env(admin情報やagentコンテナとcontrollerコンテナが接続する際に必要となる暗号鍵やagent名を登録できる)

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
# UIでの手動設定(かつ設定の属人化)を避ける
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
version: "3.8"

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
      - "192.168.11.20:8082:8080" #コンテナの8080ポートからホストの8082ポートIP192.168.11.20に接続
    networks:
      - jenkins-net
  jenkins-agent:
    build:
      context: ../../ObjectDetection/robust-object-detection/.devcontainer
      dockerfile: Dockerfile
      target: ci-agent #devステージではなく、ci-agentステージがビルドされる
    volumes:
      - ccache-data:/ccache #開発時と同じccacheを共有し,CIでの再ビルトを高速化。開発コンテナが生成済みである必要がある
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
  ccache-data:
    external: true
    name: devcontainer_ccache-data
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
    }
    triggers{
        pollSCM('H/30 9-22 * * * ')
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
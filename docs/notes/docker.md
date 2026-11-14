# Dockerの備忘録

## dockercomposeのキーワード

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
    healthcheck:
        test: ["CMD", "curl", "-fs", "httt://localhost:8080/login"]
        interval: 10s
        restries: 12
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
        jenkins-controller:
            condition: service_healthy # healthcheckが成功するまで待つ
    # 現段階(2026/9/24)ではCPUのみのテスト範囲とする。
    restart: unless-stopped

networks:
  jenkins-net:

volumes:
  jenkins-ccache:
```


|単語|動作|
|---|---|
|networks|コンテナ間での仮想ネットワーク利用可能にする(リストでネットワーク名を入れる)|
|ports|ホストにて解放するポートを示す|
|depend-on|サービス同士の起動順を決める(depend-onが宣言されているサービスを起動する前に宣言されたサービスを起動する)|
|condition|

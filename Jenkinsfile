pipeline{
    agent{label 'dl-node-editor'}
    options{
        disableConcurrentBuilds() // 同時実行を一つに制限
        timeout(time: 60, unit: 'MINUTES') //30分でタイムアウト
        buildDiscarder(logRotator(numToKeepStr: '20')) // 直近20回分だけ残す
    }
    stages{
        stage('CI'){
            stages{
                stage('ai-engine(cpp)'){
                    stages{
                        stage('configure'){
                            steps{
                                dir('apps/backend/ai-engine'){
                                sh 'cmake -S . -B build -G Ninja' // シェルコマンドでC++のconfigure setting
                                }
                            }
                        }
                        stage('build'){
                            steps{
                                dir('apps/backend/ai-engine'){
                                    sh 'cmake --build build -j2'
                                }
                            }
                        }
                        stage('test'){
                            steps{
                                dir('apps/backend/ai-engine'){
                                    sh 'ctest --test-dir build --output-on-failure -j2 -L cpu '
                                }
                            }
                        }
                    }
                }
                stage('api(rust)'){
                    stages{
                        stage('Format'){
                            steps{
                                dir('apps/backend/api'){
                                    sh 'cargo fmt --check'
                                }
                            }
                        }
                        stage('clippy'){
                            steps{
                                dir('apps/backend/api'){
                                    sh 'cargo clippy --all-targets -- -D warnings'
                                }
                            }
                        }
                        stage('build'){
                            steps{
                                dir('apps/backend/api'){
                                    sh 'cargo build --release --locked'
                                }
                            }
                        }
                        stage('test'){
                            steps{
                                dir('apps/backend/api'){
                                    sh 'cargo test --locked'
                                }
                            }
                        }
                    }
                }
                stage('flontend(typescript)'){
                    stages{
                        stage('install'){
                            steps{
                                dir('apps/frontend'){
                                    sh 'npm ci' // package-lock.jsonの通りに入れる
                                }
                            }
                        }
                        stage('lint'){
                            steps{
                                dir('apps/frontend'){
                                    sh 'npm run lint' // package.jsonにlingスクリプトがあるため
                                }
                            }
                        }
                        stage('type check'){
                            steps{
                                dir('apps/frontend'){
                                    sh 'npx tsc --noEmit' // 型エラーを検出
                                }
                            }
                        }
                        stage('test'){
                            steps{
                                dir('apps/frontend'){
                                    sh 'npx vitest run --passWithNoTests' // Viteのテスト(まだテストファイルがないため実行しない)
                                }
                            }
                        }
                        stage('build'){
                            steps{
                                dir('apps/frontend'){
                                    sh 'npm run build'
                                }
                            }
                        }
                    }
                }
            }
        }
        stage('Deploy'){
            steps{
                withCredentials([sshUserPrivateKey(credentialsId: 'dlnodeeditor-deploy-ssh', keyFileVariable: 'KEY')]) {
                    sh 'ssh -p 60022 -i "$KEY" DlNodeEditor-deploy@192.168.11.20 "cd /d E:/apps/dl-node-editor && git pull --ff-only && docker compose -f .deploy/compose.prod.yml up -d --build --remove-orphans"'
                }
            }
        }
    }
}
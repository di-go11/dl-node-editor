pipeline{
    agent{label 'ai-engine'}
    options{
        disableConcurrentBuilds() // 同時実行を一つに制限
        timeout(time: 30, unit: 'MINUTES') //30分でタイムアウト
        buildDiscarder(logRotator(numToKeepStr: '20')) // 直近20回分だけ残す
    }
    stages{
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
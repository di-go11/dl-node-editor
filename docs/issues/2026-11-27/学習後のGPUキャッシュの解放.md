# fix:学習が終わったら、libtorch がキャッシュしている GPU メモリを返す

## 問題点

学習が終わっても(完了・停止・失敗のどれでも)、ai-engine は学習中に使った GPU のメモリを持ったままになる。

- 例: SegNet 100 層・バッチ 16 の学習が OOM で失敗した後も、`nvidia-smi` では ai-engine が約 30 GB を使っているように見える
- ai-engine が学習していない間でも、同じ GPU をほかのプログラム(Python での実験など)で使えない

### 原因

libtorch のキャッシュアロケータは、破棄されたテンソルのメモリを OS(ドライバ)に返さず、次の確保のためにプロセスの中に取っておく。

- 学習が終わると、モデル・optimizer・途中の計算結果のテンソルは `runTrainingJob` を抜けるときにすべて破棄される。ただし、メモリはキャッシュに戻るだけで返らない
- ai-engine の**次の学習**はこのキャッシュを使い回せる。足りなければ libtorch がキャッシュを解放してから確保し直すので、OOM の後でも再起動せずに次の学習ができる。困るのは**ほかのプログラムが使えない**ことだけ

## 方針

**学習が終わるたびに `c10::cuda::CUDACachingAllocator::emptyCache()` を呼び、使っていないキャッシュを返す。**

- 呼ぶのは学習の**終わりだけ**にする。学習の途中で呼ぶと、毎回ドライバから確保し直すことになって遅くなる
- CUDA で学習したときだけ呼ぶ(CPU の学習では呼ばない。CUDA を初期化していないプロセスで余計なことをしない)
- 完了・停止・失敗(OOM などの例外)のどれで終わっても呼ぶ

### この変更で変わること・変わらないこと

| | 内容 |
|---|---|
| 変わる | 学習が終わった後の ai-engine の GPU メモリが、数百 MB〜1 GB 程度(CUDA の初期化分)まで下がる。ほかのプログラムがその GPU を使える |
| 変わらない | CUDA の初期化分(CUDA のコンテキスト、cuDNN・cuBLAS の作業領域)は、プロセスが終わるまで返らない |
| 変わらない | OOM そのものは防げない(100 層・バッチ 16 が 32 GB に入らないことは同じ) |
| 変わらない | device-side assert などで CUDA が壊れたときは直らない |
| 損 | 次の学習の最初の数ステップで、メモリをドライバから確保し直す分だけ遅くなる(学習全体から見ればわずか) |

CUDA の初期化分の解放と、CUDA が壊れたときの回復は「[学習ジョブの子プロセス化](../2026-11-26/学習ジョブの子プロセス化.md)」で扱う。そちらの問題点 1 に「このissueとは別に先に入れてよい」と書いた変更がこれにあたる。

### 再起動で対処しない理由

「OOM が起きたらプロセスを終了し、コンテナの `restart: unless-stopped` で立ち上げ直す」案は採らない。

- 上のとおり、OOM の後も ai-engine は次の学習ができる。再起動が要るのは CUDA が壊れたときだけ
- プロセスが落ちると Rust への進捗のストリームが途中で切れ、失敗の理由(OOM)が DB に残らないおそれがある
- 立ち上げ直す間(数秒〜数十秒)は、学習の受付も設定の検証もできない

## 設計

### どこで呼ぶか

`TrainingJobManager`(adapters)は torch の具体的な関数を知らないままにし、学習の実行(`JobRunner`)を組み立てる `GrpcApp.cpp` で、**`runTrainingJob` の呼び出しを RAII のガードで包む**。

```cpp
// GrpcApp.cpp の JobRunner
[trainingRuntimeConfig](const StartTrainingCommand &command, ...)
{
    // 学習が終わったら(例外で抜けたときも)キャッシュを返す。
    // ガードの破棄は runTrainingJob の後なので、学習のテンソルはすでに破棄されている
    const CudaCacheReleaseGuard releaseCache(command.device);
    SeedApplier seedApplier;
    return runTrainingJob(trainingRuntimeConfig, command, progressObserver, seedApplier, stopToken);
}
```

- 例外(OOM など)で抜けるときも、`runTrainingJob` の中のテンソルが先に破棄され、その後にガードの破棄で `emptyCache()` が呼ばれる。順序が保証されるので、`TrainingJobManager` の `catch` に書くより確実
- CLI(`ai_engine_app` を引数なしで動かす学習)は、学習が終わればプロセスが終わるので対象外

### 新しく作るもの(infrastructure)

| ファイル | 内容 |
|---|---|
| `src/training/infrastructure/torchFunc/CudaCacheRelease.{hpp,cpp}` | `releaseCudaCache()`: `c10::cuda::CUDACachingAllocator::emptyCache()` を呼ぶ。`CudaCacheReleaseGuard`: 作るときに device を覚え、破棄のときに CUDA なら `releaseCudaCache()` を呼ぶ |

- ガードのデストラクタは例外を投げない(`emptyCache()` の例外は捕まえてログに出すだけにする。解放に失敗しても学習の結果は変えない)
- テストのために、解放する関数を差し替えられるようにする(コンストラクタで `std::function<void()>` を受け取る。既定は `releaseCudaCache`)

### ビルド

- いまの libtorch は CUDA 版(`.devcontainer/Dockerfile.ai-engine` の cu132)なので、`c10/cuda/CUDACachingAllocator.h` をそのまま使える
- 将来 CPU 版の libtorch でビルドする環境を作る場合は、`releaseCudaCache()` の中身だけをビルドの条件で空にする(呼び出し側は変えない)

## テスト

- `cuda_cache_release_test`(新規。GPU は要らない。解放する関数を偽物に差し替える)
    - device が CUDA なら、ガードを抜けたときに 1 回呼ばれる
    - device が CPU なら呼ばれない
    - ガードの中で例外が投げられても、抜けるときに呼ばれる
    - 解放する関数が例外を投げても、ガードの外には漏れない
- GPU のある環境での手動の確認(下の完了条件)

## 完了条件

- CUDA での学習が完了・停止・失敗(OOM)のどれで終わった後も、`nvidia-smi` の ai-engine の使用量が数百 MB〜1 GB 程度まで下がる
- その後、同じ GPU でほかのプログラムがメモリを確保できる
- 続けて次の学習を始めても、これまでどおり動く
- 既存のテスト(`training_job_manager_test` など)がそのまま通る

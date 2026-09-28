#include "ThreadExecutor.hpp"

#include <thread>
#include <vector>
#include <atomic>

ThreadExecutor::ThreadExecutor(const size_t threadCount) : _threadCount(threadCount)
{
}

void ThreadExecutor::parallelFor(size_t count, const std::function<void(size_t)> &body)
{
    std::atomic<size_t> next{0};                             // 反復処理の次のインデックスを保持する原子変数。複数スレッドから同時にアクセスされても安全にインクリメントできる。
    const size_t numThreads = std::min(_threadCount, count); // スレッド数は反復回数を超えないようにする。

    std::vector<std::thread> threads;
    threads.reserve(numThreads);

    for (size_t t = 0; t < numThreads; ++t)
    {
        threads.emplace_back([&next, count, &body]()
                             {
        size_t i;
        while ((i = next.fetch_add(1)) < count) // fetch_addは原子変数の値をインクリメントし、元の値を返すメンバ関数。複数スレッドから同時にアクセスされても安全にインクリメントできる。
        {
            body(i); // 反復処理の本体を実行する。
        } });
    }
    for (auto &thread : threads)
    {
        thread.join(); // joinはスレッドの終了を待つメンバ関数。joinを呼び出すと、スレッドが終了するまで呼び出し元のスレッドはブロックされる。
    }
}

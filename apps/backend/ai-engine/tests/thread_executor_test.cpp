// ThreadExecutor(並列の for)の単体テスト。
// 特に、別スレッドで投げられた例外が std::terminate にならず、呼び出し元に届くことを確かめる。

#include "training/adapters/impl/parallelProcessFn/ThreadExecutor.hpp"

#include <atomic>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace
{
    int failureCount = 0;

    void check(bool condition, const std::string &message)
    {
        if (condition)
        {
            std::cout << "[PASS] " << message << std::endl;
        }
        else
        {
            std::cout << "[FAIL] " << message << std::endl;
            ++failureCount;
        }
    }
} // namespace

int main()
{
    // すべての添字がちょうど 1 回ずつ処理される。
    {
        ThreadExecutor executor(4);
        std::vector<std::atomic<int>> visited(100);
        executor.parallelFor(visited.size(), [&](size_t i)
                             { visited[i].fetch_add(1); });
        bool allOnce = true;
        for (const auto &v : visited)
        {
            allOnce = allOnce && v.load() == 1;
        }
        check(allOnce, "parallelFor: すべての添字を 1 回ずつ処理する");
    }

    // count = 0 なら何もしない。
    {
        ThreadExecutor executor(4);
        std::atomic<int> calls{0};
        executor.parallelFor(0, [&](size_t)
                             { calls.fetch_add(1); });
        check(calls.load() == 0, "parallelFor: count = 0 なら body を呼ばない");
    }

    // body の例外が呼び出し元に届く(std::terminate にならない)。
    {
        ThreadExecutor executor(4);
        bool caught = false;
        std::string message;
        try
        {
            executor.parallelFor(50, [](size_t i)
                                 {
                                     if (i == 7)
                                     {
                                         throw std::runtime_error("failed at 7");
                                     } });
        }
        catch (const std::runtime_error &e)
        {
            caught = true;
            message = e.what();
        }
        check(caught && message == "failed at 7", "parallelFor: body の例外を呼び出し元で投げ直す");
    }

    // 複数のスレッドが同時に失敗しても、例外は 1 つだけ届く。
    {
        ThreadExecutor executor(4);
        bool caught = false;
        try
        {
            executor.parallelFor(50, [](size_t)
                                 { throw std::runtime_error("always fails"); });
        }
        catch (const std::runtime_error &)
        {
            caught = true;
        }
        check(caught, "parallelFor: 全スレッドが失敗しても例外を 1 つ投げ直す");
    }

    // 例外のあとも、同じ executor を使い続けられる。
    {
        ThreadExecutor executor(2);
        try
        {
            executor.parallelFor(10, [](size_t)
                                 { throw std::runtime_error("x"); });
        }
        catch (const std::runtime_error &)
        {
        }
        std::atomic<int> calls{0};
        executor.parallelFor(10, [&](size_t)
                             { calls.fetch_add(1); });
        check(calls.load() == 10, "parallelFor: 例外のあとも再利用できる");
    }

    if (failureCount == 0)
    {
        std::cout << "All thread executor tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}

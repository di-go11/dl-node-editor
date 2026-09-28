// 並列処理の実装。

#pragma once

#include "training/application/interfaces/parallelProcessFn/IParallelExecutor.hpp"

#include <functional>

class ThreadExecutor : public IParallelExecutor
{
public:
    explicit ThreadExecutor(const size_t threadCount);
    void parallelFor(size_t count, const std::function<void(size_t)> &body) override;

private:
    size_t _threadCount;
};
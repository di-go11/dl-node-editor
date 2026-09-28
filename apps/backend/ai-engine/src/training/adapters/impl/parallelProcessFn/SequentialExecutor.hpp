// 逐次処理での実装。並列化する際に同様の動作ができているかを確かめるために存在する。
#pragma once

#include "training/application/interfaces/parallelProcessFn/IParallelExecutor.hpp"

#include <functional>

class SequentialExecutor : public IParallelExecutor
{
public:
    void parallelFor(size_t count, const std::function<void(size_t)> &body) override;
};
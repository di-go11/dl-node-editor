// 並列処理のインターフェース
#pragma once

#include <cstddef>
#include <functional>

class IParallelExecutor
{
public:
    virtual void parallelFor(size_t count, const std::function<void(size_t)> /*constにするのは、関数オブジェクトが一時オブジェクトであるため、そのオブジェクトを書き換えるという概念自体が存在しないから。*/ &body) = 0; // 反復処理を並列で実行するための制約
};
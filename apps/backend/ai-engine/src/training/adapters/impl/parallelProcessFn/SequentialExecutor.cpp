#include "SequentialExecutor.hpp"

void SequentialExecutor::parallelFor(size_t count, const std::function<void(size_t)> &body)
{
    for (size_t i = 0; i < count; ++i)
    {
        body(i); // ラムダ式の引数をiとして渡している。こうすることでSequentialExecutorはラムダ関数をstd::functionオブジェクトとして受け取り、それをSequentialExecutorのparallelForメソッド内で順次実行することができる。
    }
}
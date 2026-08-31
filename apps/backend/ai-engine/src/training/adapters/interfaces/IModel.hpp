#pragma once

#include <memory>

namespace at
{
    class Tensor;
}

class ILoss;
class IOptimizer;

class IModel
{
public:
    virtual ~IModel() = default;

    // prediction には正規化済み入力テンソルを渡す。損失は最終層の生ロジットに対して計算する
    // (最終活性化 softmax 等は損失側 or 推論側の責務。ここでは掛けない)。
    virtual void train(at::Tensor &prediction, at::Tensor &target, ILoss &loss, IOptimizer &optimizer) = 0;
};
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
    // virtual void train(at::Tensor &prediction, at::Tensor &target, ILoss &loss, IOptimizer &optimizer) = 0;
    // 純粋な順伝播。勾配、更新なし。 validation / inferenceからも使用される。
    virtual at::Tensor forward(const at::Tensor &input) = 0;
    // 学習の1ステップ。内部でforwardを呼び出し、その後loss計算、勾配計算、パラメータ更新を行う。学習時に使用される。
    virtual void trainStep(at::Tensor &input, at::Tensor &target, ILoss &loss, IOptimizer &optimizer) = 0;

    // BatchNorm 等の挙動を切り替える
    virtual void setTrain() = 0;
    virtual void setEval() = 0;
};
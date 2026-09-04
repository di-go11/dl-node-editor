#pragma once

#include <memory>
#include <vector>

namespace at
{
    class Tensor;
}

class ILoss;
class IOptimizer;
class ICheckpointWriter;
class ICheckpointReader;

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
    // 戻り値は更新前(backward前)に計算した loss テンソル(集計・ログ用)。
    virtual at::Tensor trainStep(at::Tensor &input, at::Tensor &target, ILoss &loss, IOptimizer &optimizer) = 0;

    // 学習対象パラメータ(重み・バイアス)のハンドル。返るテンソルはモデル内部と
    // 記憶域を共有するため、Optimizer に渡して更新させることができる。
    // checkpoint からのモデル再構築(CheckpointModelLoader)では、構築した IModel の
    // これを Optimizer に渡して両者を結び付ける。
    virtual std::vector<at::Tensor> parameters() const = 0;

    // モデル重みを archive へ書き出す / archive から復元する。
    // archive の実体・フォーマットは infrastructure 層(libtorch)が握る。
    virtual void writeTo(ICheckpointWriter &archive) const = 0;
    virtual void readFrom(ICheckpointReader &archive) = 0;

    // BatchNorm 等の挙動を切り替える
    virtual void setTrain() = 0;
    virtual void setEval() = 0;
};

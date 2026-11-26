#pragma once

#include "training/entities/domain-objects/OptimizerType.hpp"

class ICheckpointWriter;
class ICheckpointReader;

class IOptimizer
{
public:
    virtual ~IOptimizer() = default;
    virtual void resetGradients() = 0;                        // 勾配リセット
    virtual void updateParmeters() = 0;                       // パラメータ更新
    virtual void updateLearningRate(double learningRate) = 0; // 学習率設定(更新用)
    // いま使っている学習率(全 param group で同じ値にしている)。スケジューラが変えた後の値。
    // エポックの終わりに読んで進捗で送る(学習率のグラフ。issue「学習の安定化」の段階 3c)
    virtual double learningRate() const = 0;

    // 自分がどの Optimizer なのか。checkpoint に記録して、復元時に
    // 「Adam の状態を SGD に読ませる」といった取り違えを検出するために使う。
    virtual OptimizerType type() const = 0;

    // Optimizer の内部状態(exp_avg / exp_avg_sq / step / momentum_buffer 等)を
    // archive へ書き出す / archive から復元する。
    // archive の実体・フォーマットは infrastructure 層(libtorch)が握る。
    virtual void writeTo(ICheckpointWriter &archive) const = 0;
    virtual void readFrom(ICheckpointReader &archive) = 0;
};

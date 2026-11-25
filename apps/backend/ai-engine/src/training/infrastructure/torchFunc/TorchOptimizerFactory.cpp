#include "training/infrastructure/torchFunc/TorchOptimizerFactory.hpp"

#include "training/infrastructure/torchFunc/AdamOptimizer.hpp"
#include "training/infrastructure/torchFunc/AdamWOptimizer.hpp"
#include "training/infrastructure/torchFunc/SGDOptimizer.hpp"

// 各 Optimizer はデストラクタを .cpp 側に閉じ込めているため、
// ここで <torch/torch.h> を include する必要はない(libtorch を知らずに生成できる)。

#include "training/entities/utils/Overloaded.hpp"

#include <variant>

std::shared_ptr<IOptimizer> TorchOptimizerFactory::create(std::vector<at::Tensor> &parameters,
                                                          const OptimizerConfig &config)
{
    // 学習率は全種別共通のフィールドから取り、種別固有の値だけを visit で振り分ける。
    // variant の全 alternative を扱うため、種別を足し忘れるとコンパイルエラーになる。
    const double learningRate = config.learningRate;
    return std::visit(
        Overloaded{
            [&](const AdamOptimizerConfig &c) -> std::shared_ptr<IOptimizer>
            {
                return std::make_shared<AdamOptimizer>(parameters, learningRate,
                                                       c.beta1, c.beta2, c.eps, c.weightDecay);
            },
            [&](const AdamWOptimizerConfig &c) -> std::shared_ptr<IOptimizer>
            {
                return std::make_shared<AdamWOptimizer>(parameters, learningRate,
                                                        c.beta1, c.beta2, c.weightDecay);
            },
            [&](const SGDOptimizerConfig &c) -> std::shared_ptr<IOptimizer>
            {
                return std::make_shared<SGDOptimizer>(parameters, learningRate,
                                                      c.momentum, c.weightDecay, c.nesterov);
            },
        },
        config.kind);
}

#include "training/infrastructure/torchFunc/TorchOptimizerFactory.hpp"

#include "training/infrastructure/torchFunc/AdamOptimizer.hpp"
#include "training/infrastructure/torchFunc/AdamWOptimizer.hpp"
#include "training/infrastructure/torchFunc/SGDOptimizer.hpp"

// 各 Optimizer はデストラクタを .cpp 側に閉じ込めているため、
// ここで <torch/torch.h> を include する必要はない(libtorch を知らずに生成できる)。

#include <variant>

namespace
{
    // TorchLayerBuilder と同じ、variant を型ごとに分岐させるための補助。
    template <class... Ts>
    struct Overloaded : Ts...
    {
        using Ts::operator()...;
    };
    template <class... Ts>
    Overloaded(Ts...) -> Overloaded<Ts...>;
}

std::shared_ptr<IOptimizer> TorchOptimizerFactory::create(std::vector<at::Tensor> &parameters,
                                                          const OptimizerConfig &config)
{
    // variant の全 alternative を扱うため、種別を足し忘れるとコンパイルエラーになる。
    return std::visit(
        Overloaded{
            [&](const AdamOptimizerConfig &c) -> std::shared_ptr<IOptimizer>
            {
                return std::make_shared<AdamOptimizer>(parameters, c.learningRate,
                                                       c.beta1, c.beta2, c.eps, c.weightDecay);
            },
            [&](const AdamWOptimizerConfig &c) -> std::shared_ptr<IOptimizer>
            {
                return std::make_shared<AdamWOptimizer>(parameters, c.learningRate,
                                                        c.beta1, c.beta2, c.weightDecay);
            },
            [&](const SGDOptimizerConfig &c) -> std::shared_ptr<IOptimizer>
            {
                return std::make_shared<SGDOptimizer>(parameters, c.learningRate,
                                                      c.momentum, c.weightDecay, c.nesterov);
            },
        },
        config);
}

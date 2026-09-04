#pragma once

#include "training/adapters/interfaces/IOptimizerFactory.hpp"

#include <memory>
#include <vector>

// IOptimizerFactory の libtorch 実装。OptimizerConfig(variant)を std::visit で
// 分岐し、AdamOptimizer / AdamWOptimizer / SGDOptimizer を出し分ける。
// 種別固有のハイパーパラメータ(beta1 / eps / momentum / nesterov)も
// そのまま各 Optimizer に渡る。
class TorchOptimizerFactory : public IOptimizerFactory
{
public:
    std::shared_ptr<IOptimizer> create(std::vector<at::Tensor> &parameters,
                                       const OptimizerConfig &config) override;
};

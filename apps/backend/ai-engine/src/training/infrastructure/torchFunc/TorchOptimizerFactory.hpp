#pragma once

#include "training/adapters/interfaces/IOptimizerFactory.hpp"

#include <memory>
#include <vector>

// IOptimizerFactory の libtorch 実装。OptimizerConfig::type で
// AdamOptimizer / AdamWOptimizer / SGDOptimizer を出し分ける。
//
// 制約: AppConfig は OptimizerConfig を「基底の値」で保持しているため、
// 派生 (AdamOptimizerConfig 等) の beta1 / beta2 / eps / momentum / nesterov は
// ここまで届かない。それらは各 Optimizer のコンストラクタ既定値が使われる。
// (OptimizerConfig を variant 化するか多相にするかは別途検討。issue 参照)
class TorchOptimizerFactory : public IOptimizerFactory
{
public:
    std::shared_ptr<IOptimizer> create(std::vector<at::Tensor> &parameters,
                                       const OptimizerConfig &config) override;
};

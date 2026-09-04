#include "training/infrastructure/torchFunc/TorchOptimizerFactory.hpp"

#include "training/infrastructure/torchFunc/AdamOptimizer.hpp"
#include "training/infrastructure/torchFunc/AdamWOptimizer.hpp"
#include "training/infrastructure/torchFunc/SGDOptimizer.hpp"

// 各 Optimizer はデストラクタを .cpp 側に閉じ込めているため、
// ここで <torch/torch.h> を include する必要はない(libtorch を知らずに生成できる)。

#include <stdexcept>
#include <string>

std::shared_ptr<IOptimizer> TorchOptimizerFactory::create(std::vector<at::Tensor> &parameters,
                                                          const OptimizerConfig &config)
{
    switch (config.type)
    {
    case OptimizerType::Adam:
        // beta1 / beta2 / eps はコンストラクタ既定値。weight_decay のみ config から。
        return std::make_shared<AdamOptimizer>(parameters, config.learningRate,
                                               /*beta1=*/0.9, /*beta2=*/0.999,
                                               /*eps=*/1e-8, config.weightDecay);
    case OptimizerType::AdamW:
        return std::make_shared<AdamWOptimizer>(parameters, config.learningRate,
                                                /*beta1=*/0.9, /*beta2=*/0.999,
                                                config.weightDecay);
    case OptimizerType::SGD:
        return std::make_shared<SGDOptimizer>(parameters, config.learningRate,
                                              /*momentum=*/0.9, config.weightDecay,
                                              /*nesterov=*/false);
    }

    throw std::runtime_error(
        "TorchOptimizerFactory::create: 未知の OptimizerType (" +
        std::to_string(static_cast<int>(config.type)) + ")");
}

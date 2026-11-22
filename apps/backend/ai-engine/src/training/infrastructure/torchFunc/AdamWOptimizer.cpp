#include "training/infrastructure/torchFunc/AdamWOptimizer.hpp"
#include "training/infrastructure/torchFunc/OptimizerLoadKeepingOptions.hpp"
#include "training/infrastructure/torchFunc/OptimizerStateDeviceSync.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"

#include <torch/torch.h>

AdamWOptimizer::AdamWOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double beta1, double beta2, double weight_decay)
{
    _optim = std::make_unique<torch::optim::AdamW>(parameters, torch::optim::AdamWOptions(learningRate).betas(std::make_pair(beta1, beta2)).weight_decay(weight_decay));
}

// ここは <torch/torch.h> を include 済みで torch::optim::AdamW が完全型のため、
// unique_ptr の破棄コードをこの TU に閉じ込められる。
AdamWOptimizer::~AdamWOptimizer() = default;

void AdamWOptimizer::resetGradients()
{
    _optim->zero_grad();
}

void AdamWOptimizer::updateParmeters()
{
    _optim->step();
}

void AdamWOptimizer::updateLearningRate(double learningRate)
{
    for (auto &group : _optim->param_groups())
    {
        group.options().set_lr(learningRate);
    }
}

void AdamWOptimizer::writeTo(ICheckpointWriter &archive) const
{
    _optim->save(toTorchArchive(archive));
}

void AdamWOptimizer::readFrom(ICheckpointReader &archive)
{
    // 状態(exp_avg / exp_avg_sq / step)は checkpoint から引き継ぎ、lr などは今回の指定値のまま残す
    // (学習再開時にハイパーパラメータを変えられるようにするため)。
    training::infrastructure::torchFunc::loadStateKeepingOptions<torch::optim::AdamWOptions>(
        *_optim, toTorchArchive(archive));

    // load 直後は state が保存時の device 上にあるため、param の device へ揃える
    // (CPU 保存 → GPU 再開 などで step() が壊れるのを防ぐ)。
    training::infrastructure::torchFunc::syncOptimizerStateToParamDevice<torch::optim::AdamWParamState>(
        *_optim,
        [](torch::optim::AdamWParamState &s, const torch::Device &dev)
        {
            if (s.exp_avg().defined())
                s.exp_avg(s.exp_avg().to(dev));
            if (s.exp_avg_sq().defined())
                s.exp_avg_sq(s.exp_avg_sq().to(dev));
            if (s.max_exp_avg_sq().defined())
                s.max_exp_avg_sq(s.max_exp_avg_sq().to(dev));
        });
}
#include "training/infrastructure/torchFunc/SGDOptimizer.hpp"
#include "training/infrastructure/torchFunc/OptimizerLoadKeepingOptions.hpp"
#include "training/infrastructure/torchFunc/OptimizerStateDeviceSync.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"

#include <torch/torch.h>

SGDOptimizer::SGDOptimizer(std::vector<at::Tensor> &parameters, double learningRate, double momentum, double weight_decay, bool nesterov)
{
    _optim = std::make_unique<torch::optim::SGD>(parameters, torch::optim::SGDOptions(learningRate).momentum(momentum).weight_decay(weight_decay).nesterov(nesterov));
}

// ここは <torch/torch.h> を include 済みで torch::optim::SGD が完全型のため、
// unique_ptr の破棄コードをこの TU に閉じ込められる。
SGDOptimizer::~SGDOptimizer() = default;

void SGDOptimizer::resetGradients()
{
    _optim->zero_grad();
}

void SGDOptimizer::updateParmeters()
{
    _optim->step();
}

void SGDOptimizer::updateLearningRate(double learningRate)
{
    for (auto &group : _optim->param_groups())
    {
        group.options().set_lr(learningRate);
    }
}

void SGDOptimizer::writeTo(ICheckpointWriter &archive) const
{
    _optim->save(toTorchArchive(archive));
}

void SGDOptimizer::readFrom(ICheckpointReader &archive)
{
    // 状態(momentum_buffer)は checkpoint から引き継ぎ、lr などは今回の指定値のまま残す
    // (学習再開時にハイパーパラメータを変えられるようにするため)。
    training::infrastructure::torchFunc::loadStateKeepingOptions<torch::optim::SGDOptions>(
        *_optim, toTorchArchive(archive));

    // load 直後は state(momentum_buffer)が保存時の device 上にあるため、
    // param の device へ揃える(CPU 保存 → GPU 再開 などで step() が壊れるのを防ぐ)。
    training::infrastructure::torchFunc::syncOptimizerStateToParamDevice<torch::optim::SGDParamState>(
        *_optim,
        [](torch::optim::SGDParamState &s, const torch::Device &dev)
        {
            if (s.momentum_buffer().defined())
                s.momentum_buffer(s.momentum_buffer().to(dev));
        });
}
double SGDOptimizer::learningRate() const
{
    // updateLearningRate は全 param group に同じ値を入れるので、先頭の group を読めば足りる
    return _optim->param_groups().at(0).options().get_lr();
}

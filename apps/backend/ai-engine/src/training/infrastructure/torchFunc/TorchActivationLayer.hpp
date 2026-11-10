#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/adapters/interfaces/IActivation.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationSpec.hpp"

#include <memory>

class TorchActivationLayer : public ILayer
{
public:
    explicit TorchActivationLayer(const ActivationSpec &params);
    std::vector<at::Tensor> forward(const std::vector<at::Tensor> &inputs) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;
    void to(const ComputeDevice &device) override;

private:
    std::shared_ptr<IActivation> _activation;
};
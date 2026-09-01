#pragma once

#include "training/adapters/interfaces/ILayer.hpp"
#include "training/adapters/interfaces/IActivation.hpp"
#include "training/entities/domain-objects/ActivationParams.hpp"

#include <memory>

class TorchActivationLayer : public ILayer
{
public:
    explicit TorchActivationLayer(const ActivationParams &params);
    void forward(const at::Tensor &input, at::Tensor &output) override;
    std::vector<at::Tensor> parameters() const override;
    void setTrain(bool trainingMode) override;

private:
    std::shared_ptr<IActivation> _activation;
};
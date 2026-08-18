#include "training/adapters/interfaces/IActivation.hpp"

class ReLU : public IActivation
{
public:
    ReLU();
    void activate(const torch::Tensor &input, torch::Tensor &output) {}
};
#include "../../../adapters/interfaces/IActivation.hpp"

class ReLU : public IActivation
{
public:
    ReLL();
    void activate(const torch::Tensor &input, torch::Tensor &output) {}
};
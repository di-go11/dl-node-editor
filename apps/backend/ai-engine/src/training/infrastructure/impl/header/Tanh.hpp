#include "../../../adapters/interfaces/IActivation.hpp"

class Tanh : public IActivation
{
public:
    Tanh();
    void activate(const torch::Tensor &input, torch::Tensor &output) {}
};
#include "../../../adapters/interfaces/IActivation.hpp"

class Sigmoid : public IActivation
{
public:
    Sigmoid();
    void activate(const torch::Tensor &input, torch::Tensor &output) override;
};
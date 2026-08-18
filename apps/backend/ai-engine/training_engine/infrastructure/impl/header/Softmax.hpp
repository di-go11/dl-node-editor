#include "../../../adapters/interfaces/IActivation.hpp"

class Softmax : public IActivation
{
public:
    Softmax();
    void activate(const torch::Tensor &input, torch::Tensor &output) {}
};
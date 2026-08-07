#include "../../../adapters/interfaces/IActivation.hpp"

class Sigmoid : public IActivation
{
private:
    torch::Tensor &_input;
    torch::Tensor &_output;

public:
    Sigmoid();
    void activate(const torch::Tensor &input, torch::Tensor &output) {}
};
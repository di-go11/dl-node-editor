#include "../../../adapters/interfaces/IActivation.hpp"

class ReLL : public IActivation
{
private:
    torch::Tensor &_input;
    torch::Tensor &_output;

public:
    ReLL();
    void activate(const torch::Tensor &input, torch::Tensor &output) {}
};
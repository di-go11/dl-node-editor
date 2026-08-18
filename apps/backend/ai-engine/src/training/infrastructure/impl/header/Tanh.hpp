#include "../../../adapters/interfaces/IActivation.hpp"

class Tanh : public IActivation
{
public:
    Tanh();
    void activate(const at::Tensor &input, at::Tensor &output) override;
};
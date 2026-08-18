#include "../../../adapters/interfaces/IActivation.hpp"

class Softmax : public IActivation
{
public:
    Softmax();
    void activate(const at::Tensor &input, at::Tensor &output) override;
};
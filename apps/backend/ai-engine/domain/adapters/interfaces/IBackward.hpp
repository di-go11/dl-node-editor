namespace torch
{
    class Tensor;
};

class IBackward
{
public:
    virtual ~IBackward() = default;
    virtual torch::Tensor computeBackward(const torch::Tensor &input, torch::Tensor &output) = 0;
};
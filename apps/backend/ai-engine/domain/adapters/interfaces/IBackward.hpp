namespace torch
{
    class Tensor;
};

class IBackward
{
public:
    virtual ~IBackward() = default;
    virtual torch::Tensor computeBackword() = 0;
};
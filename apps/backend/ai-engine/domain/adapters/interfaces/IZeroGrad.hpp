namespace torch
{
    class Tensor;
};

class IZeroGrad
{
public:
    virtual ~IZeroGrad() = default;
    virtual torch::Tensor computeZeroGrad() = 0;
};
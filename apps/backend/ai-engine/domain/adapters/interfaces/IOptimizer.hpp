namespace torch
{
    class Tensor;
};

class IOptimizer
{
public:
    virtual ~IOptimizer() = default;
    virtual torch::Tensor computeOpimizer() = 0;
};
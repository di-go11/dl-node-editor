namespace torch
{
    class Tensor;
};

class IOptimization
{
public:
    virtual ~IOptimization() = default;
    virtual torch::Tensor computeOpimizer() = 0;
};
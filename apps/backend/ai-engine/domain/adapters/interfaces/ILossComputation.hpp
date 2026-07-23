namespace torch
{
    class Tensor;
}

class TrainParam;

class ILossComputation
{
public:
    virtual torch::Tensor computeLoss(const TrainParam &trainParam, const torch::Tensor &predicted, const torch::Tensor &target) = 0;
};
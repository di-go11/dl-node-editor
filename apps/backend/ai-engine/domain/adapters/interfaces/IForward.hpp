namespace torch
{
    class Tensor;
};

struct IModelAchManager
{
    // 仮想デストラクタ  (メモリリーク防止)
    virtual ~IModelAchManager() = default;

    virtual torch::Tensor computeForward(torch::Tensor x) = 0;
};

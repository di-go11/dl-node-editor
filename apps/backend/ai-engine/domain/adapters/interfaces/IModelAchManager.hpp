#include <torch/torch.h>

struct IModelAchManager : torch::nn::Module
{
    // 仮想デストラクタ  (メモリリーク防止)
    virtual ~IModelAchManager() = default;

    virtual torch::Tensor forward(torch::Tensor x) = 0;
};

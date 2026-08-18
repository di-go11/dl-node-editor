#include <torch/torch.h>

#include "./TorchModelTrainer.hpp"
#include "./BatchTensorConverter.hpp"

#include <stdexcept>
#include <utility>

#include "../../entities/domain-objects/TrainParam.hpp"
#include "../../entities/domain-objects/BatchData.hpp"

#include "../interfaces/IModel.hpp"
#include "../interfaces/ILoss.hpp"
#include "../interfaces/IOptimizer.hpp"
#include "../interfaces/IZeroGrad.hpp"

namespace
{
    class NullActivation : public IActivation
    {
    public:
        void activate(const torch::Tensor &input, torch::Tensor &output) override
        {
            output = input;
        }
    };
} // namespace

TorchModelTrainer::TorchModelTrainer(
    const std::shared_ptr<IModel> &model,
    const std::string &weightPath,
    const std::string &graphPath)
    : _model(model),
      _weightPath(weightPath),
      _graphPath(graphPath)
{
}

TorchModelTrainer::~TorchModelTrainer() = default;

void TorchModelTrainer::train(BatchData &predictionBatchData, BatchData &targetBatchData, TrainParam &trainParam)
{
    BatchTensorConverter converter;

    // Lossの実装を後で行う

    std::shared_ptr<ILoss> loss;
    std::shared_ptr<IOptimizer> optimizer;
    std::shared_ptr<IZeroGrad> zeroGrad;
    std::shared_ptr<IActivation> activation = std::make_shared<NullActivation>();

    std::shared_ptr<IModel> model = _model;

    torch::Tensor predictionTensor = converter.convert(predictionBatchData);
    torch::Tensor targetTensor = converter.convert(targetBatchData);

    model->train(predictionTensor, targetTensor, *loss, *optimizer, *zeroGrad, *activation);
}
#include <memory>
#include <string>
#include "../../application/interfaces/IModelTrainer.hpp"

class IModelAchManager;
class IBackward;
class ILoss;
class IOptimizer;
class IZeroGrad;
class BatchData;
class TrainParam;

class TorchModelTrainer : public IModelTrainer
{
private:
    const std::shared_ptr<IModelAchManager> _forward;
    const std::shared_ptr<ILoss> _loss;
    const std::shared_ptr<IBackward> _backward;
    const std::shared_ptr<IOptimizer> _optimizer;
    const std::shared_ptr<IZeroGrad> _zerograd;
    std::string _weightPath;
    std::string _graphPath;

public:
    TorchModelTrainer(
        const std::shared_ptr<IModelAchManager> &forward,
        const std::shared_ptr<ILoss> &loss,
        const std::shared_ptr<IBackward> &backward,
        const std::shared_ptr<IOptimizer> &optimizer,
        const std::shared_ptr<IZeroGrad> &zerograd,
        const std::string &weightPath,
        const std::string &graphPath);
    ~TorchModelTrainer() override;

    void train(BatchData &predictionBatchData, BatchData &targetBatchData, TrainParam &trainParam) override;
};

#include <memory>
#include <string>
#include "../../application/interfaces/IModelTrainer.hpp"

class IForward;
class ILoss;
class IOptimizer;
class IZeroGrad;
class BatchData;
class TrainParam;

class TorchModelTrainer : IModelTrainer
{
private:
    std::shared_ptr<IForward> _forward;
    std::shared_ptr<ILoss> _loss;
    std::shared_ptr<IBackward> _backward;
    std::shared_ptr<IOptimizer> _optimizer;
    std::shared_ptr<IZeroGrad> _zerograd;
    std::string _weightPath;
    std::string _graphPath;

public:
    TorchModelTrainer(const std::shared_ptr<IForward> &forward, const std::string &weightPath, const std::string &graphPath);
    ~TorchModelTrainer();

    void train(BatchData *batchData, TrainParam *trainParam) override = 0;
};

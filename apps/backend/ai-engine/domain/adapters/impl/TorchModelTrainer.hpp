#include <memory>
#include <string>
#include "../../application/interfaces/IModelTrainer.hpp"

class IModelAchManager;
class BatchData;
class TrainParam;

class TorchModelTrainer : IModelTrainer
{
private:
    std::shared_ptr<IModelAchManager> _modelArch;
    std::string _weightPath;
    std::string _graphPath;

public:
    TorchModelTrainer(const std::shared_ptr<IModelAchManager> &modelArch, const std::string &weightPath, const std::string &graphPath);
    ~TorchModelTrainer();

    void train(BatchData *batchData, TrainParam *trainParam) override = 0;
};

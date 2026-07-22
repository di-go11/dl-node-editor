#include <memory>
#include <string>

class IModelarchitecture;
class BatchData;

class TorchModelTrainer
{
private:
    std::shared_ptr<IModelarchitecture> _modelArch;
    std::string _weightPath;
    std::string _graphPath;

public:
    TorchModelTrainer(const std::shared_ptr<IModelarchitecture> &modelArch, const std::string &weightPath, const std::string &graphPath);
    ~TorchModelTrainer();

    void train(BatchData *batchData);
};

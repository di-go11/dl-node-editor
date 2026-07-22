#include <memory>
#include <string>

class Modelarchitecture;
class BatchData;

class TorchModelTrainer
{
private:
    std::shared_ptr<Modelarchitecture> _modelArch;
    std::string _weightPath;
    std::string _graphPath;

public:
    TorchModelTrainer(const std::shared_ptr<Modelarchitecture> &modelArch, const std::string &weightPath, const std::string &graphPath);
    ~TorchModelTrainer();

    void train(BatchData *batchData);
};

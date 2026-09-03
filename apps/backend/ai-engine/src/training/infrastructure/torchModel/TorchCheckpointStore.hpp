#pragma once

#include "training/application/interfaces/ICheckpointStore.hpp"

#include <memory>
#include <string>

class IModel;
class IOptimizer;

class TorchCheckpointStore : public ICheckpointStore
{
public:
    TorchCheckpointStore(std::shared_ptr<IModel> model, std::shared_ptr<IOptimizer> optimizer, std::string outputDir, std::string modelName);
    void saveBest(unsigned int epoch) override;

private:
    std::shared_ptr<IModel> _model;
    std::shared_ptr<IOptimizer> _optimizer;
    std::string _outputDir;
    std::string _modelName;
    std::string checkpointPath() const;
};

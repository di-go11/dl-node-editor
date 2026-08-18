#pragma once

#include <memory>
#include <string>
#include "../../application/interfaces/IModelTrainer.hpp"
#include "../interfaces/IModel.hpp"

class BatchData;
class TrainParam;

class TorchModelTrainer : public IModelTrainer
{
private:
    const std::shared_ptr<IModel> _model;
    std::string _weightPath;
    std::string _graphPath;

public:
    TorchModelTrainer(
        const std::shared_ptr<IModel> &model,
        const std::string &weightPath,
        const std::string &graphPath);
    ~TorchModelTrainer() override;

    void train(BatchData &predictionBatchData, BatchData &targetBatchData, TrainParam &trainParam) override;
};

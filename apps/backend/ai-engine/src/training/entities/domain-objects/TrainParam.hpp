#ifndef TRAIN_PARAM_HPP
#define TRAIN_PARAM_HPP

#include <memory>

#include "../interface/IModelConfig.hpp"
#include "../interface/ILossFnConfig.hpp"

class TrainParam {
private:
    std::shared_ptr<IModelConfig> _modelConfig;
    std::shared_ptr<ILossFnConfig> _lossFnConfig;

    unsigned int _epochSize;
    unsigned int _batchSize;
    double _learningRate;

public:
    TrainParam(std::shared_ptr<IModelConfig> modelconfig, std::shared_ptr<ILossFnConfig> lossfnconfig, unsigned int epochsize, unsigned int batchsize, double learningrate);
    ~TrainParam() = default;

    double getLr() const;
    unsigned int getEpochSize() const;
    unsigned int getBatchSize() const;
    std::shared_ptr<IModelConfig> getModelConfig() const;
    std::shared_ptr<ILossFnConfig> getLossFnConfig() const;
};

#endif // TRAIN_PARAM_HPP
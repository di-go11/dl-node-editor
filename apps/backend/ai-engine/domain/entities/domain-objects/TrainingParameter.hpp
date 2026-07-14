#ifndef TRAINING_PARAMETER_HPP
#define TRAINING_PARAMETER_HPP

#include <memory>

#include "../interface/IModelConfig.hpp"
#include "../interface/ILossFnConfig.hpp"

class TrainingParameter {
private:
    std::shared_ptr<IModelConfig> _modelConfig;
    std::shared_ptr<ILossFnConfig> _lossFnConfig;

    unsigned int _epochSize;
    unsigned int _batchSize;
    double _learningRate;

public:
    TrainingParameter(std::shared_ptr<IModelConfig> modelconfig, std::shared_ptr<ILossFnConfig> lossfnconfig, unsigned int epochsize, unsigned int batchsize, double learningrate);
    ~TrainingParameter() = default;

    double getLr() const;
    unsigned int getEpochSize() const;
    unsigned int getBatchSize() const;
    std::shared_ptr<IModelConfig> getModelConfig() const;
    std::shared_ptr<ILossFnConfig> getLossFnConfig() const;
};

#endif // TRAINING_PARAMETER_HPP
#include "../../entities/domain-objects/BatchData.hpp"

class IModelTrainer
{
public:
    virtual ~IModelTrainer() = default;
    virtual void train(BatchData batchData) = 0;
};
#include "./IModelTrainer.hpp"

class ITorch : public IModelTrainer
{
public:
    virtual ~ITorch() = default;
    virtual void train() = 0;
};
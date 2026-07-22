class BatchData;

class IModelTrainer
{
public:
    virtual ~IModelTrainer() = default;
    virtual void train(BatchData *batchData) = 0;
};
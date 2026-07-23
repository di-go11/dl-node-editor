class BatchData;
class TrainParam;

class IModelTrainer
{
public:
    virtual ~IModelTrainer() = default;
    virtual void train(BatchData *batchData, TrainParam *trainParam) = 0;
};
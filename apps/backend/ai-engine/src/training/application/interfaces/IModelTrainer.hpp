class BatchData;
class TrainParam;

class IModelTrainer
{
public:
    virtual ~IModelTrainer() = default;
    virtual void train(BatchData &predictionBatchData, BatchData &targetBatchData, TrainParam &trainParam) = 0;
};
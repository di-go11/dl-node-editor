#include <memory>
#include <vector>

// インターフェース、クラスの前方宣言
class TrainParam;
class IPathProvidor;
class IModelTrainer;
class IDatasetRepository;
class DatasetSize;
class BatchData;

class TrainModelUsecase
{
private:
    std::shared_ptr<TrainParam> _param;
    std::shared_ptr<IPathProvidor> _path;
    std::shared_ptr<IModelTrainer> _trainer;
    std::shared_ptr<DatasetSize> _datasetSize;
    std::shared_ptr<BatchData> _batchData;
    std::shared_ptr<IDatasetRepository> _datasetRepository;

public:
    TrainModelUsecase(const std::shared_ptr<TrainParam> &param, const std::shared_ptr<IPathProvidor> &path, const std::shared_ptr<IModelTrainer> &trainer, const std::shared_ptr<DatasetSize> &datasetSize);
    ~TrainModelUsecase() = default;

    void execute(IDatasetRepository *dataset);
};
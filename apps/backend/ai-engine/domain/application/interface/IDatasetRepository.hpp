class BatchData;
class DatasetSize;

class IDatasetRepository
{
public:
    virtual ~IDatasetRepository() = default;
    virtual BatchData *getBatchData() = 0;
    virtual DatasetSize *getDatasetSize() = 0;
};
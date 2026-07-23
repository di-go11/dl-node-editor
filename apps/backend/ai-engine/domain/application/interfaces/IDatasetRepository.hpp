class BatchData;

class IDatasetRepository
{
public:
    virtual ~IDatasetRepository() = default;
    virtual BatchData *getBatchData() = 0;
};
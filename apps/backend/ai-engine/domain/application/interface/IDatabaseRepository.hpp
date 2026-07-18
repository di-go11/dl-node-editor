#include "../../entities/domain-objects/BatchData.hpp"

class IDatasetRepository
{
public:
    virtual ~IDatasetRepository() = default;
    virtual BatchData getBatchData() = 0;
};
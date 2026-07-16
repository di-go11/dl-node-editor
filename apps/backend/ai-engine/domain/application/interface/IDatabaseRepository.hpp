#include <vector>

class IDatasetRepository
{
    public:
        virtual ~IDatasetRepository() = default;
        virtual std::vector<std::vector<float>> getArray() = 0;
};
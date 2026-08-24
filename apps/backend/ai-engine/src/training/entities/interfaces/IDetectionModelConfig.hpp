#include "./IModelConfig.hpp"

class IDetectionModelConfig : public IModelConfig
{
    public:
        virtual ~IDetectionModelConfig() = default;
        virtual std::string getModelType() const = 0;
        virtual std::string getNetworkType() const = 0;
};
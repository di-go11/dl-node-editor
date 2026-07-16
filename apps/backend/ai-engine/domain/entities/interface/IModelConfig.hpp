#include <string>

class IModelConfig
{
public:
    virtual ~IModelConfig() = default;
    virtual std::string getModelType() const = 0;
};
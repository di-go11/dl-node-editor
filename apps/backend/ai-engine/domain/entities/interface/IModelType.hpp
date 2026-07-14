#include <string>

class IModelType
{
public:
    virtual ~IModelType() = default;
    virtual std::string getModelType() const = 0;
};
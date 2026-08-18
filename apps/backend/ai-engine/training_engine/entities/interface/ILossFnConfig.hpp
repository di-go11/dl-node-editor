#include <string>

class ILossFnConfig
{
public:
    virtual ~ILossFnConfig() = default;
    virtual std::string getLossFnType() const = 0;
};
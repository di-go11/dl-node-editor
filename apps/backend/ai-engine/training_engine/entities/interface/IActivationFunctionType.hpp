#include<string>

class IActivationFunctionType
{
public:
    virtual ~IActivationFunctionType() = default;
    virtual std::string getType() const = 0;
};
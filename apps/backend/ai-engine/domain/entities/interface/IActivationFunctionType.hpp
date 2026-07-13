class IActivationFunctionType
{
public:
    virtual ~IActivationFunctionType() = default;
    virtual ActivationFunction getType() const = 0;
};
class IModelType
{
public:
    virtual ~IModelType() = default;
    virtual Model getModelType() const = 0;
};
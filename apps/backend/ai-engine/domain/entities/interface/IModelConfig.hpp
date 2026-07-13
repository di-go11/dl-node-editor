class IModelConfig
{
public:
    virtual ~IModelConfig() = default;
    virtual Model getModelType() const = 0;
};
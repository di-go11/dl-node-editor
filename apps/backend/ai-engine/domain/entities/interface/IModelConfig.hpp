class IModelConfig {
    public:
        virtual ~IModelConfig() = default;
        virtual ModelType getModelType() const = 0;
};
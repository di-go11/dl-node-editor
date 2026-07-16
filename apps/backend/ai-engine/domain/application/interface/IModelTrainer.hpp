class IModelTrainer
{
    public:
        virtual ~IModelTrainer() = default;
        virtual void train() = 0;
};
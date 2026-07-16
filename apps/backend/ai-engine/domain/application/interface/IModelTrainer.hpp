#include <vector>

struct TrainData{
    
}
class IModelTrainer
{
public:
    virtual ~IModelTrainer() = default;
    virtual void train() = 0;
};
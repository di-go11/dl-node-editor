#include "../entities/domain-objects/TrainParam.hpp"
#include "../interface/IDatabaseRepository.hpp"
#include "../interface/IModelTrainer.hpp"
#include "../interface/IPathProvidor.hpp"

#include <memory>

class TrainModelUsecase {
    private:
        std::shared_ptr<TrainParam> _param;
        std::shared_ptr<IPathProvidor> _path;
        std::shared_ptr<IModelTrainer> _trainer;
    
    public:
        TrainModelUsecase(std::shared_ptr<TrainParam> param, std::shared_ptr<IPathProvidor> path, std::shared_ptr<IModelTrainer> trainer);
        ~TrainModelUsecase() = default;

        void execute(IDatasetRepository *dataset);
};
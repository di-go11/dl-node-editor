#include "training/infrastructure/torchModel/TorchModelFactory.hpp"

#include "training/infrastructure/torchModel/TorchModel.hpp"

std::shared_ptr<IModel> TorchModelFactory::create(const validatedModelGraph &graph, const ComputeDevice &device)
{
    return std::make_shared<TorchModel>(graph, _builder, device);
}

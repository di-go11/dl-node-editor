#include <memory>
#include <torch/torch.h>

// entities
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/Conv2DParams.hpp"
#include "training/entities/domain-objects/ActivationParams.hpp"

// infrastructure(具象クラス)
#include "training/infrastructure/torchFunc/TorchLayerBuilder.hpp"
#include "training/infrastructure/torchModel/TorchModel.hpp"
#include "training/infrastructure/torchFunc/AdamOptimizer.hpp"
#include "training/infrastructure/torchFunc/MseLoss.hpp" // または CrossEntropy.hpp
#include "training/infrastructure/torchFunc/ReLU.hpp"    // モデル全体の最終活性化用
#include "training/infrastructure/readConfig/ConfigReader.hpp"

#include "training/infrastructure/dataset/OpenCvImageDecoder.hpp"

// adapters/application(具象クラス)
#include "training/adapters/impl/TorchModelTrainer.hpp"
#include "training/application/impl/TrainModelUsecase.hpp"

// 自作するダミー
#include "training/infrastructure/dataset/DummyDatasetRepository.hpp"

ModelGraph buildSampleModelGraph()
{
    ModelGraph graph;

    Conv2DParams conv;
    conv.inChannels = 1;
    conv.outChannels = 4;
    conv.kernelSize = 3;
    conv.stride = 1;
    conv.padding = 1;
    graph.layers.push_back(LayersConfig{conv});

    ActivationParams relu;
    relu.activationType = ActivationType::ReLU;
    graph.layers.push_back(LayersConfig{relu});

    return graph;
}

int main(void)
{
    // configの読み込み
    ConfigReader configReader;

    AppConfig appConfig = configReader.readAll(".config");

    // TrainParamの設定
    auto param = std::make_shared<TrainParam>(/*epochsize*/ 1, /*batchsize*/ 1);
    // ModelGraph
    ModelGraph graph = buildSampleModelGraph();

    TorchLayerBuilder builder;
    auto model = std::make_shared<TorchModel>(graph, builder);

    std::vector<at::Tensor> params = model->parameters();
    auto optimizer = std::make_shared<AdamOptimizer>(params, /*learning rate*/ 0.001);

    auto loss = std::make_shared<MseLoss>();

    auto activation = std::make_shared<ReLU>();

    auto trainer = std::make_shared<TorchModelTrainer>(model, loss, optimizer, activation);

    TrainModelUsecase usecase(param, appConfig, trainer);

    DummyDatasetRepository dataset;
    usecase.execute(&dataset);

    std::cout << "training loop finished" << std::endl;

    return 0;
}
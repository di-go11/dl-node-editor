// CPU と CUDA で学習結果が概ね一致することを確認するテスト。
//
//   - 同一 seed で CPU / CUDA それぞれにモデルを構築(初期重みは CPU RNG で
//     生成されるため一致する)
//   - 同一の入力・ターゲットで数ステップ学習し、各ステップの loss を比較
//   - 最終パラメータを CPU に集めて比較
//
// cuDNN の非決定性・reduction 順序の差があるため厳密一致は求めず、緩めの
// 許容誤差で「概ね一致」を確認する。CUDA が無い環境では CPU 側だけ実行して skip。

#include <cmath>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "training/entities/domain-objects/ComputeDevice.hpp"
#include "training/entities/domain-objects/Conv2DParams.hpp"
#include "training/entities/domain-objects/ActivationConfig.hpp"
#include "training/entities/domain-objects/ActivationType.hpp"
#include "training/entities/domain-objects/LayersConfig.hpp"
#include "training/entities/domain-objects/ModelGraph.hpp"
#include "training/entities/domain-objects/OptimizerConfig.hpp"

#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/IOptimizer.hpp"

#include "training/infrastructure/torchFunc/CrossEntropy.hpp"
#include "training/infrastructure/torchFunc/TorchOptimizerFactory.hpp"
#include "training/infrastructure/torchModel/TorchModelFactory.hpp"

namespace
{
int failureCount = 0;

void check(bool condition, const std::string &message)
{
    std::cout << (condition ? "[PASS] " : "[FAIL] ") << message << std::endl;
    if (!condition)
    {
        ++failureCount;
    }
}

constexpr int kNumClasses = 3;
constexpr int kSteps = 5;
constexpr int64_t kSeed = 20240611;

ModelGraph makeGraph()
{
    ModelGraph graph;

    Conv2DParams conv1;
    conv1.inChannels = 3;
    conv1.outChannels = 8;
    conv1.kernelSize = 3;
    conv1.stride = 1;
    conv1.padding = 1;
    graph.layers.push_back(LayersConfig{conv1});

    ActivationConfig act;
    act.activationType = ActivationType::ReLU;
    graph.layers.push_back(LayersConfig{act});

    Conv2DParams conv2;
    conv2.inChannels = 8;
    conv2.outChannels = kNumClasses;
    conv2.kernelSize = 3;
    conv2.stride = 1;
    conv2.padding = 1;
    graph.layers.push_back(LayersConfig{conv2});

    return graph;
}

// device 上で kSteps ステップ学習し、各ステップの loss を返す。
// input / target は CPU で seed 固定生成 → 呼び出し側で渡す(両 device 同一)。
std::vector<double> runTraining(const ComputeDevice &device,
                                const ModelGraph &graph,
                                const at::Tensor &inputCpu,
                                const at::Tensor &targetCpu,
                                std::vector<at::Tensor> &finalParamsOut)
{
    TorchModelFactory modelFactory;
    TorchOptimizerFactory optimizerFactory;

    // 初期重みは torch::nn の初期化が CPU の global generator を使うため、
    // create の直前に seed を張れば CPU/CUDA で同一の初期値になる。
    torch::manual_seed(kSeed);
    std::shared_ptr<IModel> model = modelFactory.create(graph, device);

    std::vector<at::Tensor> params = model->parameters();
    AdamOptimizerConfig adam;
    adam.learningRate = 0.01;
    const OptimizerConfig optimizerConfig = adam;
    std::shared_ptr<IOptimizer> optimizer = optimizerFactory.create(params, optimizerConfig);

    CrossEntropy loss;

    at::Tensor input = inputCpu.clone();
    at::Tensor target = targetCpu.clone();

    std::vector<double> losses;
    losses.reserve(kSteps);
    for (int i = 0; i < kSteps; ++i)
    {
        at::Tensor l = model->trainStep(input, target, loss, *optimizer);
        losses.push_back(l.item<double>());
    }

    finalParamsOut.clear();
    for (const auto &p : model->parameters())
    {
        finalParamsOut.push_back(p.detach().to(torch::kCPU).clone());
    }
    return losses;
}
} // namespace

int main()
{
    const ModelGraph graph = makeGraph();

    // 入力・ターゲットを seed 固定で生成(CPU)。
    torch::manual_seed(kSeed + 1);
    const at::Tensor input = torch::randn({2, 3, 16, 16});
    const at::Tensor target = torch::randint(0, kNumClasses, {2, 16, 16},
                                             torch::TensorOptions().dtype(torch::kInt64));

    std::vector<at::Tensor> cpuFinal;
    const std::vector<double> cpuLosses =
        runTraining(ComputeDevice{ComputeDeviceType::Cpu, 0}, graph, input, target, cpuFinal);

    std::cout << "CPU  losses:";
    for (double l : cpuLosses)
        std::cout << " " << l;
    std::cout << std::endl;

    check(cpuLosses.front() > cpuLosses.back(), "CPU: loss がステップで減少する");

    if (!torch::cuda::is_available())
    {
        std::cout << "[skip] CUDA is unavailable; CPU/CUDA parity check skipped." << std::endl;
        if (failureCount == 0)
        {
            std::cout << "device parity test passed (CPU only)." << std::endl;
            return 0;
        }
        return 1;
    }

    std::vector<at::Tensor> cudaFinal;
    const std::vector<double> cudaLosses =
        runTraining(ComputeDevice{ComputeDeviceType::Cuda, 0}, graph, input, target, cudaFinal);

    std::cout << "CUDA losses:";
    for (double l : cudaLosses)
        std::cout << " " << l;
    std::cout << std::endl;

    // 各ステップの loss が概ね一致(cuDNN 差を見込んで緩め)。
    bool lossesClose = true;
    for (int i = 0; i < kSteps; ++i)
    {
        const double diff = std::fabs(cpuLosses[i] - cudaLosses[i]);
        const double rel = diff / std::max(1e-6, std::fabs(cpuLosses[i]));
        if (diff > 1e-3 && rel > 1e-2)
        {
            lossesClose = false;
            std::cout << "  step " << i << ": cpu=" << cpuLosses[i]
                      << " cuda=" << cudaLosses[i] << " diff=" << diff << std::endl;
        }
    }
    check(lossesClose, "CPU と CUDA の各ステップ loss が概ね一致する");

    // 最終パラメータの一致(CPU に集約して比較)。
    bool paramsClose = (cpuFinal.size() == cudaFinal.size());
    for (std::size_t i = 0; i < cpuFinal.size() && paramsClose; ++i)
    {
        if (!torch::allclose(cpuFinal[i], cudaFinal[i], /*rtol=*/1e-3, /*atol=*/1e-4))
        {
            paramsClose = false;
            std::cout << "  param " << i << " max abs diff = "
                      << (cpuFinal[i] - cudaFinal[i]).abs().max().item<double>() << std::endl;
        }
    }
    check(paramsClose, "CPU と CUDA の最終パラメータが概ね一致する");

    if (failureCount == 0)
    {
        std::cout << "All device parity tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}

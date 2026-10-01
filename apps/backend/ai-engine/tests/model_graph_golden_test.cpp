// ModelGraph の表現や TorchModel の実行方法を作り替えても、計算結果が変わらないことを確認するテスト。
//
// 小さい SegNet 型のグラフ(IndexedPooling / Unpooling を 2 組)を CPU・固定 seed で組み立て、
// 次の値を、作り替える前のコードで記録した値(下の kExpected*)と比べる。
//
//   1. 構築直後の各パラメータの合計値(層の生成順と parameters() の並び順が変わっていないこと)
//   2. 構築直後の順伝播の出力(層のつながりと indices の対応が変わっていないこと)
//   3. 数ステップ学習したときの各ステップの loss(逆伝播とパラメータ更新が変わっていないこと)
//   4. 学習後の順伝播の出力(BatchNorm の統計量の更新も含めて変わっていないこと)
//
// グラフの表現を変えるとき(線形リスト → DAG など)に書き換えるのは makeGraph() だけ。
// kExpected* の値は変えないこと。値が合わなくなったら、計算の中身が変わっている。
//
// 期待値は docs/issues/model-graph-dag.md の手順 0 で、線形リスト版のコードから取得した。

#include <cmath>
#include <cstdint>
#include <iomanip>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "training/entities/domain-objects/ModelGraph/Layers/ActivationConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/ActivationType.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/BatchNormParams.hpp"
#include "training/entities/domain-objects/ComputeDevice.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/Conv2DParams.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/IndexedPoolingParams.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/LayersConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/ModelGraph.hpp"
#include "training/entities/domain-objects/OptimizerConfig.hpp"
#include "training/entities/domain-objects/ModelGraph/Layers/UnpoolingParams.hpp"

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
    constexpr int kSteps = 3;
    constexpr int64_t kSeed = 20261001;

    // 期待値との許容誤差。CPU の種類(AVX2 / AVX-512 など)による丸めの違いを見込む。
    // つなぎ方や層の順番を間違えた場合は、これより桁違いに大きくずれる。
    constexpr double kTolerance = 1e-4;

    // ---- 期待値(線形リスト版のコードで取得。変更しないこと) ----

    // 構築直後の各パラメータの合計値。parameters() の並び順。
    const std::vector<double> kExpectedInitialParamSums = {
        -0.9971463680267334,
        0.15864071249961853,
        4,
        0,
        -0.58635425567626953,
        0.015282521955668926,
        8,
        0,
        0.46753436326980591,
        0.10837045311927795,
        4,
        0,
        -1.2988172769546509,
        0.19548039138317108,
        3,
        0,
    };

    // 構築直後(eval モード)の順伝播の出力。
    constexpr double kExpectedInitialOutputSum = 99.651885986328125;
    constexpr double kExpectedInitialOutputAbsSum = 99.651885986328125;
    const std::vector<double> kExpectedInitialOutputSamples = {
        0.030674632638692856,
        0.089424155652523041,
        0.15811546146869659,
        0.061263829469680786,
    };

    // 学習の各ステップの loss。
    const std::vector<double> kExpectedLosses = {
        1.3695144653320312,
        1.1895018815994263,
        1.1039658784866333,
    };

    // 学習後(eval モード)の順伝播の出力。
    constexpr double kExpectedTrainedOutputSum = -117.57355499267578;
    constexpr double kExpectedTrainedOutputAbsSum = 280.24005126953125;

    // ---- グラフ ----

    void appendConvReluBn(ModelGraph &graph, int inChannels, int outChannels)
    {
        Conv2DParams conv;
        conv.inChannels = inChannels;
        conv.outChannels = outChannels;
        conv.kernelSize = 3;
        conv.stride = 1;
        conv.padding = 1;
        graph.layers.push_back(LayersConfig{conv});

        ActivationConfig relu;
        relu.activationType = ActivationType::ReLU;
        graph.layers.push_back(LayersConfig{relu});

        BatchNormParams bn;
        bn.numFeatures = outChannels;
        bn.momentum = 0.5;
        graph.layers.push_back(LayersConfig{bn});
    }

    // SegNet を小さくした構成。
    //   enc1: Conv(3→4)-ReLU-BN → IndexedPooling
    //   enc2: Conv(4→8)-ReLU-BN → IndexedPooling
    //   dec2: Unpooling(enc2 の indices) → Conv(8→4)-ReLU-BN
    //   dec1: Unpooling(enc1 の indices) → Conv(4→クラス数)-ReLU-BN
    //
    // グラフの表現を変えるときは、この関数だけを書き換える。
    // 層を作る順番(= ノードの並び順)は変えないこと。重みの初期値がこの順番で決まる。
    ModelGraph makeGraph()
    {
        ModelGraph graph;

        appendConvReluBn(graph, 3, 4);
        graph.layers.push_back(LayersConfig{IndexedPoolingParams{}});

        appendConvReluBn(graph, 4, 8);
        graph.layers.push_back(LayersConfig{IndexedPoolingParams{}});

        graph.layers.push_back(LayersConfig{UnpoolingParams{}});
        appendConvReluBn(graph, 8, 4);

        graph.layers.push_back(LayersConfig{UnpoolingParams{}});
        appendConvReluBn(graph, 4, kNumClasses);

        return graph;
    }

    // ---- 比較 ----

    bool isClose(double actual, double expected)
    {
        return std::fabs(actual - expected) <= kTolerance;
    }

    void checkValue(double actual, double expected, const std::string &name)
    {
        const bool ok = isClose(actual, expected);
        check(ok, name);
        if (!ok)
        {
            std::cout << "    actual=" << actual << " expected=" << expected << std::endl;
        }
    }

    void checkValues(const std::vector<double> &actual, const std::vector<double> &expected, const std::string &name)
    {
        bool ok = (actual.size() == expected.size());
        for (std::size_t i = 0; ok && i < actual.size(); ++i)
        {
            ok = isClose(actual[i], expected[i]);
        }
        check(ok, name);
        if (!ok)
        {
            std::cout << "    actual(" << actual.size() << " 個):";
            for (double v : actual)
            {
                std::cout << " " << v;
            }
            std::cout << std::endl
                      << "    expected(" << expected.size() << " 個):";
            for (double v : expected)
            {
                std::cout << " " << v;
            }
            std::cout << std::endl;
        }
    }

    // 出力テンソルのうち、決まった位置の値を取り出す(N=2, C=クラス数, H=W=16 の前提)。
    std::vector<double> sampleOutput(const at::Tensor &output)
    {
        return {
            output[0][0][0][0].item<double>(),
            output[0][1][3][5].item<double>(),
            output[1][2][8][8].item<double>(),
            output[1][0][15][15].item<double>(),
        };
    }

    // 実際の値を、上の kExpected* にそのまま貼り付けられる形で出力する(値を取り直すときに使う)。
    void printValues(const std::string &name, const std::vector<double> &values)
    {
        std::cout << "  " << name << " = {";
        for (double v : values)
        {
            std::cout << std::endl
                      << "    " << v << ",";
        }
        std::cout << std::endl
                  << "  }" << std::endl;
    }
} // namespace

int main()
{
    // 足し算の順番がスレッド数で変わらないよう、1 スレッドに固定する。
    torch::set_num_threads(1);
    std::cout << std::setprecision(17);

    const ComputeDevice device{ComputeDeviceType::Cpu, 0};
    const ModelGraph graph = makeGraph();

    // 入力・ターゲットを seed 固定で生成する。
    torch::manual_seed(kSeed + 1);
    at::Tensor input = torch::randn({2, 3, 16, 16});
    at::Tensor target = torch::randint(0, kNumClasses, {2, 16, 16},
                                       torch::TensorOptions().dtype(torch::kInt64));

    // モデルの構築。重みの初期値は、create の直前の seed と層の生成順で決まる。
    TorchModelFactory modelFactory;
    torch::manual_seed(kSeed);
    std::shared_ptr<IModel> model = modelFactory.create(graph, device);

    // 1. 構築直後のパラメータ
    std::vector<at::Tensor> params = model->parameters();
    std::vector<double> initialParamSums;
    for (const auto &p : params)
    {
        initialParamSums.push_back(p.detach().sum().item<double>());
    }

    // 2. 構築直後の順伝播
    model->setEval();
    at::Tensor initialOutput;
    {
        torch::NoGradGuard noGrad;
        initialOutput = model->forward(input);
    }
    const double initialOutputSum = initialOutput.sum().item<double>();
    const double initialOutputAbsSum = initialOutput.abs().sum().item<double>();
    const std::vector<double> initialOutputSamples = sampleOutput(initialOutput);

    // 3. 学習
    TorchOptimizerFactory optimizerFactory;
    AdamOptimizerConfig adam;
    adam.learningRate = 0.01;
    const OptimizerConfig optimizerConfig = adam;
    std::shared_ptr<IOptimizer> optimizer = optimizerFactory.create(params, optimizerConfig);
    CrossEntropy loss;

    model->setTrain();
    std::vector<double> losses;
    for (int i = 0; i < kSteps; ++i)
    {
        losses.push_back(model->trainStep(input, target, loss, *optimizer).item<double>());
    }

    // 4. 学習後の順伝播
    model->setEval();
    at::Tensor trainedOutput;
    {
        torch::NoGradGuard noGrad;
        trainedOutput = model->forward(input);
    }
    const double trainedOutputSum = trainedOutput.sum().item<double>();
    const double trainedOutputAbsSum = trainedOutput.abs().sum().item<double>();

    std::cout << "---- 実際の値 ----" << std::endl;
    printValues("kExpectedInitialParamSums", initialParamSums);
    std::cout << "  kExpectedInitialOutputSum = " << initialOutputSum << std::endl;
    std::cout << "  kExpectedInitialOutputAbsSum = " << initialOutputAbsSum << std::endl;
    printValues("kExpectedInitialOutputSamples", initialOutputSamples);
    printValues("kExpectedLosses", losses);
    std::cout << "  kExpectedTrainedOutputSum = " << trainedOutputSum << std::endl;
    std::cout << "  kExpectedTrainedOutputAbsSum = " << trainedOutputAbsSum << std::endl;
    std::cout << "------------------" << std::endl;

    check(initialOutput.dim() == 4 && initialOutput.size(0) == 2 && initialOutput.size(1) == kNumClasses &&
              initialOutput.size(2) == 16 && initialOutput.size(3) == 16,
          "出力の形状が (2, クラス数, 16, 16) である");

    checkValues(initialParamSums, kExpectedInitialParamSums, "構築直後の各パラメータの合計値が一致する");
    checkValue(initialOutputSum, kExpectedInitialOutputSum, "構築直後の出力の合計値が一致する");
    checkValue(initialOutputAbsSum, kExpectedInitialOutputAbsSum, "構築直後の出力の絶対値の合計が一致する");
    checkValues(initialOutputSamples, kExpectedInitialOutputSamples, "構築直後の出力の抜き取り値が一致する");
    checkValues(losses, kExpectedLosses, "各ステップの loss が一致する");
    checkValue(trainedOutputSum, kExpectedTrainedOutputSum, "学習後の出力の合計値が一致する");
    checkValue(trainedOutputAbsSum, kExpectedTrainedOutputAbsSum, "学習後の出力の絶対値の合計が一致する");

    if (failureCount == 0)
    {
        std::cout << "All model graph golden tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}

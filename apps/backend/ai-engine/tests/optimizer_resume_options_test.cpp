// 学習再開時に、Optimizer のハイパーパラメータ(lr など)が今回の指定値で上書きされることのテスト。
//
// libtorch の Optimizer::load は、状態(exp_avg / momentum_buffer など)に加えて、
// param_group の options(lr / betas / weight_decay など)も checkpoint の値で上書きする。
// 各 *Optimizer::readFrom は状態だけを引き継ぎ、options は構築時の値に戻す。
//
// 検証方法(Adam / AdamW / SGD それぞれ):
//   1. 基準となる libtorch の Optimizer を「古い options」で数ステップ回し、状態を archive に保存する
//   2. 基準の options を手で「新しい options」に書き換える(= 期待する挙動)
//   3. ラッパーを「新しい options」で構築し、archive を readFrom する
//   4. 基準とラッパーで同じ 1 ステップを踏み、重みが一致することを確かめる
// あわせて、テストが変化を見分けられることを確かめるため、
//   - 「古い options」で構築したラッパー(= 修正前の挙動と同じ結果になる)
//   - 「新しい options」で構築し、readFrom しないラッパー(= 状態が引き継がれていない)
// は基準と一致しないことも確かめる。

#include <functional>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

#include <torch/torch.h>

#include "training/adapters/interfaces/IOptimizer.hpp"
#include "training/infrastructure/torchFunc/AdamOptimizer.hpp"
#include "training/infrastructure/torchFunc/AdamWOptimizer.hpp"
#include "training/infrastructure/torchFunc/SGDOptimizer.hpp"
#include "training/infrastructure/torchModel/TorchCheckpointArchive.hpp"

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

// 損失は ((p - target)^2).sum()。p が同じなら勾配も同じになる。
void backward(const at::Tensor &param, const at::Tensor &target)
{
    (param - target).pow(2).sum().backward();
}

void stepWrapper(IOptimizer &optimizer, const at::Tensor &param, const at::Tensor &target)
{
    optimizer.resetGradients();
    backward(param, target);
    optimizer.updateParmeters();
}

void readFromBytes(IOptimizer &optimizer, const std::string &bytes)
{
    std::istringstream is(bytes);
    torch::serialize::InputArchive archive;
    archive.load_from(is);
    TorchCheckpointReader reader(archive);
    optimizer.readFrom(reader);
}

using WrapperFactory = std::function<std::unique_ptr<IOptimizer>(std::vector<at::Tensor> &)>;

// RawOptimizer: torch::optim::{Adam,AdamW,SGD}、Options: 対応する *Options。
// makeOld / makeNew は、oldOptions / newOptions と同じ値でラッパーを構築すること。
template <class RawOptimizer, class Options>
void runCase(const std::string &name,
             const Options &oldOptions, const Options &newOptions,
             const WrapperFactory &makeOld, const WrapperFactory &makeNew)
{
    torch::manual_seed(0);
    const at::Tensor target = torch::randn({4, 3});
    const at::Tensor initial = torch::randn({4, 3});

    // 1. 基準: 古い options で数ステップ回して、状態を保存する
    at::Tensor refParam = initial.clone().requires_grad_(true);
    RawOptimizer reference(std::vector<at::Tensor>{refParam}, oldOptions);
    for (int i = 0; i < 3; ++i)
    {
        reference.zero_grad();
        backward(refParam, target);
        reference.step();
    }
    std::string bytes;
    {
        torch::serialize::OutputArchive archive;
        reference.save(archive);
        std::ostringstream os;
        archive.save_to(os);
        bytes = os.str();
    }

    // 2. 基準の options を新しい値にする(状態はそのまま)
    for (auto &group : reference.param_groups())
    {
        static_cast<Options &>(group.options()) = newOptions;
    }

    // 3. ラッパー: 保存時点の重みから、それぞれの条件で構築する
    const at::Tensor savedParam = refParam.detach().clone();

    std::vector<at::Tensor> resumedParams{savedParam.clone().requires_grad_(true)};
    auto resumed = makeNew(resumedParams);
    readFromBytes(*resumed, bytes);

    std::vector<at::Tensor> oldOptionParams{savedParam.clone().requires_grad_(true)};
    auto oldOption = makeOld(oldOptionParams);
    readFromBytes(*oldOption, bytes);

    std::vector<at::Tensor> coldParams{savedParam.clone().requires_grad_(true)};
    auto cold = makeNew(coldParams);

    // 4. 同じ 1 ステップを踏んで比べる
    reference.zero_grad();
    backward(refParam, target);
    reference.step();
    stepWrapper(*resumed, resumedParams[0], target);
    stepWrapper(*oldOption, oldOptionParams[0], target);
    stepWrapper(*cold, coldParams[0], target);

    const auto close = [](const at::Tensor &a, const at::Tensor &b)
    { return torch::allclose(a, b, /*rtol=*/1e-6, /*atol=*/1e-7); };

    check(close(refParam, resumedParams[0]),
          name + ": readFrom 後は、状態を引き継いだうえで新しい options で更新される");
    check(!close(refParam, oldOptionParams[0]),
          name + ": (感度確認)古い options のままだと結果が変わる");
    check(!close(refParam, coldParams[0]),
          name + ": (感度確認)状態を引き継がないと結果が変わる");
}
} // namespace

int main()
{
    // ---- Adam: lr / betas / eps / weight_decay をすべて変える ----
    runCase<torch::optim::Adam>(
        "Adam",
        torch::optim::AdamOptions(0.1).betas({0.9, 0.999}).eps(1e-8).weight_decay(0.0),
        torch::optim::AdamOptions(0.01).betas({0.8, 0.99}).eps(1e-6).weight_decay(0.01),
        [](std::vector<at::Tensor> &p)
        { return std::make_unique<AdamOptimizer>(p, 0.1, 0.9, 0.999, 1e-8, 0.0); },
        [](std::vector<at::Tensor> &p)
        { return std::make_unique<AdamOptimizer>(p, 0.01, 0.8, 0.99, 1e-6, 0.01); });

    // ---- AdamW: lr / betas / weight_decay を変える(eps はラッパーで指定できないので既定値) ----
    runCase<torch::optim::AdamW>(
        "AdamW",
        torch::optim::AdamWOptions(0.1).betas({0.9, 0.999}).weight_decay(0.01),
        torch::optim::AdamWOptions(0.01).betas({0.8, 0.99}).weight_decay(0.1),
        [](std::vector<at::Tensor> &p)
        { return std::make_unique<AdamWOptimizer>(p, 0.1, 0.9, 0.999, 0.01); },
        [](std::vector<at::Tensor> &p)
        { return std::make_unique<AdamWOptimizer>(p, 0.01, 0.8, 0.99, 0.1); });

    // ---- SGD: lr / momentum / weight_decay / nesterov を変える ----
    // momentum_buffer を引き継ぐことを確かめるため、両方とも momentum > 0 にする。
    runCase<torch::optim::SGD>(
        "SGD",
        torch::optim::SGDOptions(0.1).momentum(0.9).weight_decay(0.0).nesterov(false),
        torch::optim::SGDOptions(0.01).momentum(0.5).weight_decay(0.01).nesterov(true),
        [](std::vector<at::Tensor> &p)
        { return std::make_unique<SGDOptimizer>(p, 0.1, 0.9, 0.0, false); },
        [](std::vector<at::Tensor> &p)
        { return std::make_unique<SGDOptimizer>(p, 0.01, 0.5, 0.01, true); });

    if (failureCount > 0)
    {
        std::cout << failureCount << " check(s) failed" << std::endl;
        return 1;
    }
    std::cout << "all checks passed" << std::endl;
    return 0;
}

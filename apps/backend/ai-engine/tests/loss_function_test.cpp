// DiceLoss(infrastructure/torchFunc/DiceLoss)の数値的な妥当性テスト。
//
//   - 完全一致の予測(one-hot)で loss == 0 になること
//   - 完全不一致の予測で loss がほぼ 1 に近いこと
//   - ignore_index を持つ画素が、予測が外れていても loss に寄与しないこと
//
// GUI からの activation 選択を前提にした設計のため、DiceLoss::lossOut に渡す
// predicted は「既に softmax 済みの確率」であるとして、テストでも one_hot で
// 直接それを模擬する(Softmax 自体のテストはここでは行わない)。

#include <cmath>
#include <iostream>
#include <string>

#include <torch/torch.h>

#include "training/infrastructure/torchFunc/BoundaryLoss.hpp"
#include "training/infrastructure/torchFunc/ComboLoss.hpp"
#include "training/infrastructure/torchFunc/DiceLoss.hpp"
#include "training/infrastructure/torchFunc/FocalLoss.hpp"

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

void checkNear(double actual, double expected, const std::string &message, double tol = 1e-5)
{
    check(std::fabs(actual - expected) <= tol,
          message + " (expected " + std::to_string(expected) + ", got " + std::to_string(actual) + ")");
}

namespace F = torch::nn::functional;

// target([N,H,W] int64) を one-hot の確率テンソル([N,C,H,W] float)に変換する。
// 「Softmax 済みの完全に自信のある予測」を模擬するために使う。
at::Tensor probsFromTarget(const at::Tensor &target, int numClasses)
{
    return F::one_hot(target, numClasses).permute({0, 3, 1, 2}).to(torch::kFloat32);
}
} // namespace

int main()
{
    constexpr int numClasses = 2;

    // ---- 1. 完全一致の予測 -> loss == 0 ----
    {
        at::Tensor target = torch::tensor({{{0, 1}, {1, 0}}}, torch::kInt64); // [1,2,2]
        at::Tensor predicted = probsFromTarget(target, numClasses);            // [1,2,2,2]

        DiceLoss loss(numClasses);
        at::Tensor output;
        loss.lossOut(predicted, target, output);

        checkNear(output.item<double>(), 0.0, "完全一致の予測で loss == 0");
    }

    // ---- 2. 完全不一致の予測 -> loss がほぼ 1 ----
    {
        at::Tensor target = torch::zeros({1, 4, 4}, torch::kInt64); // 全画素クラス0
        at::Tensor wrongTarget = torch::ones({1, 4, 4}, torch::kInt64); // 予測は全画素クラス1
        at::Tensor predicted = probsFromTarget(wrongTarget, numClasses);

        DiceLoss loss(numClasses);
        at::Tensor output;
        loss.lossOut(predicted, target, output);

        const double lossValue = output.item<double>();
        check(lossValue > 0.9, "完全不一致の予測で loss がほぼ1 (got " + std::to_string(lossValue) + ")");
    }

    // ---- 3. ignore_index の画素は、予測が外れていても loss に寄与しない ----
    {
        constexpr int64_t ignoreIndex = 255;

        at::Tensor target = torch::tensor({{{0, 1}, {1, 0}}}, torch::kInt64); // [1,2,2] 正解
        at::Tensor targetWithIgnore = target.clone();
        targetWithIgnore.index_put_({0, 0, 0}, ignoreIndex); // 左上を ignore_index に

        // predicted は「正解と完全一致」をベースにしつつ、ignore_index にした
        // 画素(左上)だけわざと外す(one_hot する前の target を反転させる)。
        at::Tensor predictedTarget = target.clone();
        predictedTarget.index_put_({0, 0, 0}, 1 - target.index({0, 0, 0}).item<int64_t>());
        at::Tensor predicted = probsFromTarget(predictedTarget, numClasses);

        DiceLoss loss(numClasses, ignoreIndex);
        at::Tensor output;
        loss.lossOut(predicted, targetWithIgnore, output);

        // ignore_index の画素を除けば残りは全部一致しているはずなので、
        // ケース1と同じく loss == 0 になるはず(外れた画素がマスクされていれば)。
        checkNear(output.item<double>(), 0.0,
                  "ignore_index の画素(予測が外れている)が loss に影響しない");
    }

    // ==== FocalLoss ====

    // ---- 4. 手計算した値と一致するか(1画素、gamma=2, alpha=1) ----
    // pt = 0.9 (正解クラスの確率) のとき:
    //   loss = -alpha * (1-pt)^gamma * log(pt) = -1 * 0.01 * log(0.9) ≈ 0.0010536
    {
        at::Tensor predicted = torch::tensor({0.9f, 0.1f}).reshape({1, 2, 1, 1});
        at::Tensor target = torch::zeros({1, 1, 1}, torch::kInt64); // 正解はクラス0

        FocalLoss loss(numClasses, /*gamma=*/2.0, /*alpha=*/1.0);
        at::Tensor output;
        loss.lossOut(predicted, target, output);

        const double expected = -1.0 * std::pow(1.0 - 0.9, 2.0) * std::log(0.9);
        checkNear(output.item<double>(), expected, "手計算(pt=0.9, gamma=2, alpha=1)と一致");
    }

    // ---- 5. gamma=0 は (alpha 付き)Cross Entropy と一致する ----
    // loss = -alpha * log(pt)
    {
        at::Tensor predicted = torch::tensor({0.7f, 0.3f}).reshape({1, 2, 1, 1});
        at::Tensor target = torch::zeros({1, 1, 1}, torch::kInt64);

        FocalLoss loss(numClasses, /*gamma=*/0.0, /*alpha=*/1.0);
        at::Tensor output;
        loss.lossOut(predicted, target, output);

        const double expected = -std::log(0.7);
        checkNear(output.item<double>(), expected, "gamma=0 で Cross Entropy と一致(pt=0.7)");
    }

    // ---- 6. 完全一致の予測(pt=1) -> loss == 0 ----
    {
        at::Tensor target = torch::tensor({{{0, 1}, {1, 0}}}, torch::kInt64);
        at::Tensor predicted = probsFromTarget(target, numClasses);

        FocalLoss loss(numClasses, 2.0, 1.0);
        at::Tensor output;
        loss.lossOut(predicted, target, output);

        checkNear(output.item<double>(), 0.0, "FocalLoss: 完全一致の予測で loss == 0");
    }

    // ---- 7. ignore_index の画素は、予測が外れていても loss に寄与しない ----
    {
        constexpr int64_t ignoreIndex = 255;

        at::Tensor target = torch::tensor({{{0, 1}, {1, 0}}}, torch::kInt64);
        at::Tensor targetWithIgnore = target.clone();
        targetWithIgnore.index_put_({0, 0, 0}, ignoreIndex);

        at::Tensor predictedTarget = target.clone();
        predictedTarget.index_put_({0, 0, 0}, 1 - target.index({0, 0, 0}).item<int64_t>());
        at::Tensor predicted = probsFromTarget(predictedTarget, numClasses);

        FocalLoss loss(numClasses, 2.0, 1.0, ignoreIndex);
        at::Tensor output;
        loss.lossOut(predicted, targetWithIgnore, output);

        checkNear(output.item<double>(), 0.0,
                  "FocalLoss: ignore_index の画素(予測が外れている)が loss に影響しない");
    }

    // ==== ComboLoss ====
    // alpha * CrossEntropy(=FocalLoss(gamma=0,alpha=1)) + (1-alpha) * DiceLoss の
    // 加重和になっていることを確認する(数式は個別にテスト済みなので、ここでは
    // 「正しく合成できているか」だけを見る)。

    // ---- 8. 完全一致の予測 -> loss == 0(CE項・Dice項ともに0) ----
    {
        at::Tensor target = torch::tensor({{{0, 1}, {1, 0}}}, torch::kInt64);
        at::Tensor predicted = probsFromTarget(target, numClasses);

        ComboLoss loss(numClasses);
        at::Tensor output;
        loss.lossOut(predicted, target, output);

        checkNear(output.item<double>(), 0.0, "ComboLoss: 完全一致の予測で loss == 0");
    }

    // ---- 9. alpha=1.0 のとき、FocalLoss(gamma=0,alpha=1)単体と一致する ----
    {
        at::Tensor target = torch::zeros({1, 4, 4}, torch::kInt64);
        at::Tensor wrongTarget = torch::ones({1, 4, 4}, torch::kInt64);
        at::Tensor predicted = probsFromTarget(wrongTarget, numClasses);

        ComboLoss combo(numClasses, /*alpha=*/1.0);
        at::Tensor comboOutput;
        combo.lossOut(predicted, target, comboOutput);

        FocalLoss ce(numClasses, /*gamma=*/0.0, /*alpha=*/1.0);
        at::Tensor ceOutput;
        ce.lossOut(predicted, target, ceOutput);

        checkNear(comboOutput.item<double>(), ceOutput.item<double>(),
                   "ComboLoss: alpha=1.0 で CrossEntropy(FocalLoss gamma=0)単体と一致");
    }

    // ---- 10. alpha=0.0 のとき、DiceLoss単体と一致する ----
    {
        at::Tensor target = torch::zeros({1, 4, 4}, torch::kInt64);
        at::Tensor wrongTarget = torch::ones({1, 4, 4}, torch::kInt64);
        at::Tensor predicted = probsFromTarget(wrongTarget, numClasses);

        ComboLoss combo(numClasses, /*alpha=*/0.0);
        at::Tensor comboOutput;
        combo.lossOut(predicted, target, comboOutput);

        DiceLoss dice(numClasses);
        at::Tensor diceOutput;
        dice.lossOut(predicted, target, diceOutput);

        checkNear(comboOutput.item<double>(), diceOutput.item<double>(),
                   "ComboLoss: alpha=0.0 で DiceLoss単体と一致");
    }

    // ==== BoundaryLoss ====
    // 距離マップの厳密値は distance transform の実装依存になるため、手計算値との
    // 一致ではなく「正解に近い予測の方が、外れた予測より loss が小さい」という
    // 単調性と、ignore_index マスクの効果を確認する。

    // ---- 11. 正解に一致する予測は、反転させた(完全に外れた)予測より loss が小さい ----
    {
        // 左半分(列0,1)がクラス0、右半分(列2,3)がクラス1という、境界が明確なターゲット。
        at::Tensor target = torch::tensor(
            {{{0, 0, 1, 1}, {0, 0, 1, 1}, {0, 0, 1, 1}, {0, 0, 1, 1}}}, torch::kInt64); // [1,4,4]
        at::Tensor wrongTarget = 1 - target;

        at::Tensor predictedCorrect = probsFromTarget(target, numClasses);
        at::Tensor predictedWrong = probsFromTarget(wrongTarget, numClasses);

        BoundaryLoss loss(numClasses);
        at::Tensor outputCorrect;
        loss.lossOut(predictedCorrect, target, outputCorrect);
        at::Tensor outputWrong;
        loss.lossOut(predictedWrong, target, outputWrong);

        check(outputCorrect.item<double>() < outputWrong.item<double>(),
              "BoundaryLoss: 正解一致の予測の方が反転予測より loss が小さい (correct=" +
                  std::to_string(outputCorrect.item<double>()) + ", wrong=" +
                  std::to_string(outputWrong.item<double>()) + ")");
    }

    // ---- 12. ignore_index の画素は、予測がどうであれ loss に影響しない ----
    {
        constexpr int64_t ignoreIndex = 255;

        at::Tensor target = torch::tensor(
            {{{0, 0, 1, 1}, {0, 0, 1, 1}, {0, 0, 1, 1}, {0, 0, 1, 1}}}, torch::kInt64);
        at::Tensor targetWithIgnore = target.clone();
        targetWithIgnore.index_put_({0, 0, 0}, ignoreIndex); // 左上を ignore_index に

        at::Tensor predictedA = probsFromTarget(target, numClasses);
        at::Tensor predictedB = predictedA.clone();
        // ignore_index にした画素の予測だけを変える(他の画素は predictedA と同じ)。
        predictedB.index_put_({0, torch::indexing::Slice(), 0, 0},
                               probsFromTarget(1 - target, numClasses).index({0, torch::indexing::Slice(), 0, 0}));

        BoundaryLoss loss(numClasses, ignoreIndex);
        at::Tensor outputA;
        loss.lossOut(predictedA, targetWithIgnore, outputA);
        at::Tensor outputB;
        loss.lossOut(predictedB, targetWithIgnore, outputB);

        checkNear(outputA.item<double>(), outputB.item<double>(),
                   "BoundaryLoss: ignore_index の画素の予測差が loss に影響しない");
    }

    if (failureCount == 0)
    {
        std::cout << "All loss function tests passed." << std::endl;
        return 0;
    }
    std::cout << failureCount << " test(s) failed." << std::endl;
    return 1;
}

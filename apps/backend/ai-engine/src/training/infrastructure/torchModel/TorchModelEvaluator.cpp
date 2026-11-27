#include "training/infrastructure/torchModel/TorchModelEvaluator.hpp"

#include "training/application/interfaces/IDatasetRepository.hpp"

#include "training/entities/domain-objects/Metrics/EpochMetrics.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"

#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/ILoss.hpp"
#include "training/adapters/impl/BatchTensorConverter.hpp"

#include "training/entities/utils/Overloaded.hpp"

#include <torch/torch.h>

#include <limits>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace
{
    // 背景クラスのインデックス。labelmap の先頭(background)がクラス0になる。
    // meanIoU の平均からは除外する(背景が画素の大半を占め、mIoU を押し上げてしまうため)。
    constexpr int kBackgroundClass = 0;
}

TorchModelEvaluator::TorchModelEvaluator(IModel &model, ILoss &loss, int numClasses, ImageTaskSpecs taskSpecs)
    : _model(model), _loss(loss), _numClasses(numClasses), _taskSpecs(std::move(taskSpecs))
{
}

EpochMetrics TorchModelEvaluator::evaluate(IDatasetRepository &valData)
{
    return std::visit(
        Overloaded{
            [&](const SegmentationSpec &spec) -> EpochMetrics
            {
                return evaluateSegmentation(valData, spec.ignoreIndex);
            },
            [](const ObjectDetectionSpec &) -> EpochMetrics
            {
                throw std::runtime_error("TorchModelEvaluator: ObjectDetection の評価はまだ対応していません");
            },
            [](const ClassificationSpec &) -> EpochMetrics
            {
                throw std::runtime_error("TorchModelEvaluator: Classification の評価はまだ対応していません");
            },
        },
        _taskSpecs);
}

EpochMetrics TorchModelEvaluator::evaluateSegmentation(IDatasetRepository &valData, const int64_t ignoreIndex)
{
    _model.setEval();          // モデルを評価モードに設定
    torch::NoGradGuard noGrad; // このスコープ内は勾配計算を無効化

    // reset metrics
    double lossSum = 0.0;                                                                    // lossの合計(有効pixelで重み付け)
    int64_t validPixelCount = 0;                                                             // ignore_index を除いた総pixel数
    int64_t correctCount = 0;                                                                // 正解pixel数(有効pixelのみ)
    torch::Tensor confusionMatrix = torch::zeros({_numClasses, _numClasses}, torch::kInt64); // 混同行列の初期化

    BatchTensorConverter converter;

    valData.reset();

    while (valData.hasNext())
    {
        TrainingBatch batch = valData.getNextBatch();

        // BatchData を libtorch テンソルへ変換(学習時の TorchModelTrainer と同じ経路)
        torch::Tensor input = converter.convert(batch.input);         // [N,C,H,W] float
        torch::Tensor target = converter.convertTarget(batch.target); // [N,H,W]   int64

        // forward はモデルの device(CPU/CUDA)上の予測を返す。指標計算は
        // target / confusionMatrix と揃えて CPU で行うため、ここで CPU へ戻す
        // (モデルが CPU の場合は no-op)。
        torch::Tensor prediction = _model.forward(input).to(torch::kCPU); // [N,numClasses,H,W]

        torch::Tensor loss;
        _loss.lossOut(prediction, target, loss);

        // ignore_index(Letterbox 余白など)のピクセルは損失・指標から除外する。
        // 除外しないと target=255 が混同行列のインデックス(target*C+pred)を
        // はみ出させ、[C,C] への reshape が破綻する。
        const torch::Tensor validMask = (target != ignoreIndex); // [N,H,W] bool
        const int64_t validCount = validMask.sum().item<int64_t>();
        if (validCount == 0)
        {
            continue; // このバッチは全て無視対象
        }

        // cross_entropy(reduction=mean) は既に有効ピクセルで平均済みなので、
        // エポック平均を出すには有効ピクセル数で重み付けする。
        lossSum += loss.item<double>() * static_cast<double>(validCount);
        validPixelCount += validCount;

        // pixel accuracy: 有効ピクセルのみで正解数を数える
        const torch::Tensor predictedLabels = prediction.argmax(1); // [N,H,W]
        correctCount += ((predictedLabels == target) & validMask).sum().item<int64_t>();

        // 混同行列の更新: 有効ピクセルだけ取り出して bincount(target * C + pred)
        const torch::Tensor t = target.masked_select(validMask).to(torch::kInt64);
        const torch::Tensor p = predictedLabels.masked_select(validMask).to(torch::kInt64);

        // ここまで来て範囲外のクラス値が残っていれば、ignore_index 設定ミスか
        // ラベルデータの破損。cryptic な reshape エラーの代わりに明示する。
        if (t.numel() > 0 && (t.min().item<int64_t>() < 0 || t.max().item<int64_t>() >= _numClasses))
        {
            throw std::runtime_error(
                "TorchModelEvaluator: ターゲットに [0, " + std::to_string(_numClasses) +
                ") かつ ignoreIndex(" + std::to_string(ignoreIndex) +
                ") 以外の値が含まれています。ラベルマップ / ignoreIndex 設定を確認してください。");
        }

        const torch::Tensor indices = t * _numClasses + p;
        confusionMatrix += torch::bincount(indices, /*weights=*/{}, _numClasses * _numClasses)
                               .reshape({_numClasses, _numClasses});
    }

    _model.setTrain(); // 呼び出し後は学習モードへ戻す

    // --- 集計を確定 ---
    SegmentationMetricsConfig segMetrics;
    segMetrics.pixelAccuracy =
        validPixelCount > 0 ? static_cast<double>(correctCount) / static_cast<double>(validPixelCount) : 0.0;

    // 混同行列の行 = 正解クラス、列 = 予測クラス
    torch::Tensor tp = confusionMatrix.diag().to(torch::kFloat64);
    torch::Tensor fp = confusionMatrix.sum(0).to(torch::kFloat64) - tp;
    torch::Tensor fn = confusionMatrix.sum(1).to(torch::kFloat64) - tp;
    torch::Tensor denom = tp + fp + fn; // IoU の分母

    double iouSum = 0.0; // meanIoU 用(背景を除く)
    int iouClasses = 0;
    double fwIoU = 0.0;            // Σ 出現頻度 × IoU
    double classAccuracySum = 0.0; // meanClassAccuracy 用
    int accuracyClasses = 0;
    segMetrics.perClassIoU.reserve(_numClasses);
    for (int c = 0; c < _numClasses; ++c)
    {
        const double d = denom[c].item<double>();
        const double tpC = tp[c].item<double>();
        const double gtC = tpC + fn[c].item<double>(); // 正解がクラス c のピクセル数

        // IoU = TP / (TP + FP + FN)。正解にも予測にも現れないクラスは NaN にして平均から外す。
        if (d > 0.0)
        {
            const double iou = tpC / d;
            segMetrics.perClassIoU.push_back(iou);
            if (c != kBackgroundClass)
            {
                iouSum += iou;
                ++iouClasses;
            }
            // 出現頻度 = 正解がクラス c のピクセル数 / 有効ピクセル数
            fwIoU += (gtC / static_cast<double>(validPixelCount)) * iou;
        }
        else
        {
            segMetrics.perClassIoU.push_back(std::numeric_limits<double>::quiet_NaN());
        }

        // クラスごとの accuracy = TP / (TP + FN)。正解に現れないクラスは平均から外す。
        if (gtC > 0.0)
        {
            classAccuracySum += tpC / gtC;
            ++accuracyClasses;
        }
    }

    segMetrics.meanIoU = iouClasses > 0 ? iouSum / iouClasses : 0.0;
    segMetrics.fwIoU = fwIoU; // 有効ピクセルが 0 のときは全クラス d == 0 なので 0 のまま
    segMetrics.meanClassAccuracy = accuracyClasses > 0 ? classAccuracySum / accuracyClasses : 0.0;

    const torch::Tensor flat = confusionMatrix.contiguous().view({-1}); // 行優先の長さ(CxC)の平坦化された配列
    const int64_t *first = flat.data_ptr<int64_t>();
    segMetrics.confusionMatrix = std::vector<int64_t>(first, first + flat.numel()); // 範囲コンストラクタで始まりから終わりまでのアドレス先の値をコピーする。

    EpochMetrics metrics;
    metrics.loss = validPixelCount > 0 ? lossSum / static_cast<double>(validPixelCount) : 0.0;
    metrics.taskMetrics = std::move(segMetrics);
    return metrics;
}

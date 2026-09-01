#include "training/infrastructure/torchModel/TorchModelEvaluator.hpp"

#include "training/application/interfaces/IDatasetRepository.hpp"

#include "training/entities/domain-objects/EpochMetrics.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"

#include "training/adapters/interfaces/IModel.hpp"
#include "training/adapters/interfaces/ILoss.hpp"
#include "training/adapters/impl/BatchTensorConverter.hpp"

#include <torch/torch.h>

#include <limits>

TorchModelEvaluator::TorchModelEvaluator(IModel &model, ILoss &loss, int numClasses) : _model(model), _loss(loss), _numClasses(numClasses)
{
}

EpochMetrics TorchModelEvaluator::evaluate(IDatasetRepository &valData)
{
    // 評価ロジックを実装する
    // ここでは、_model を使用して valData 上で評価を行い、EpochMetrics を返す
    // 例: 損失や精度の計算など
    _model.setEval();          // モデルを評価モードに設定
    torch::NoGradGuard noGrad; // このスコープ内は勾配計算を無効化

    // reset metrics
    double lossSum = 0.0;                                                                    // lossの合計
    int64_t pixelCount = 0;                                                                  // 総pixel数
    int64_t correctCount = 0;                                                                // 正解pixel数
    torch::Tensor confusionMatrix = torch::zeros({_numClasses, _numClasses}, torch::kInt64); // 混同行列の初期化

    BatchTensorConverter converter;

    valData.reset();

    while (valData.hasNext())
    {
        TrainingBatch batch = valData.getNextBatch();

        // BatchData を libtorch テンソルへ変換(学習時の TorchModelTrainer と同じ経路)
        torch::Tensor input = converter.convert(batch.input);        // [N,C,H,W] float
        torch::Tensor target = converter.convertTarget(batch.target); // [N,H,W]   int64

        torch::Tensor prediction = _model.forward(input); // [N,numClasses,H,W]

        torch::Tensor loss;
        _loss.lossOut(prediction, target, loss);

        // 損失の合計(バッチ内ピクセル数で重み付け)
        lossSum += loss.item<double>() * target.numel();

        // pixel accuracy 用の集計
        torch::Tensor predictedLabels = prediction.argmax(1); // [N,H,W]
        correctCount += (predictedLabels == target).sum().item<int64_t>();
        pixelCount += target.numel();

        // 混同行列の更新: bincount(target * C + pred) を [C,C] に整形して加算
        torch::Tensor t = target.reshape(-1).to(torch::kInt64);
        torch::Tensor p = predictedLabels.reshape(-1).to(torch::kInt64);
        torch::Tensor indices = t * _numClasses + p;
        confusionMatrix += torch::bincount(indices, /*weights=*/{}, _numClasses * _numClasses)
                               .reshape({_numClasses, _numClasses});
    }

    _model.setTrain(); // 呼び出し後は学習モードへ戻す

    // --- 集計を確定 ---
    EpochMetrics metrics;
    metrics.loss = pixelCount > 0 ? lossSum / static_cast<double>(pixelCount) : 0.0;
    metrics.pixelAccuracy =
        pixelCount > 0 ? static_cast<double>(correctCount) / static_cast<double>(pixelCount) : 0.0;

    // クラスごとの IoU = TP / (TP + FP + FN)
    torch::Tensor tp = confusionMatrix.diag().to(torch::kFloat64);
    torch::Tensor fp = confusionMatrix.sum(0).to(torch::kFloat64) - tp;
    torch::Tensor fn = confusionMatrix.sum(1).to(torch::kFloat64) - tp;
    torch::Tensor denom = tp + fp + fn;

    double iouSum = 0.0;
    int validClasses = 0;
    metrics.perClassIoU.reserve(_numClasses);
    for (int c = 0; c < _numClasses; ++c)
    {
        const double d = denom[c].item<double>();
        if (d > 0.0)
        {
            const double iou = tp[c].item<double>() / d;
            metrics.perClassIoU.push_back(iou);
            iouSum += iou;
            ++validClasses;
        }
        else
        {
            metrics.perClassIoU.push_back(std::numeric_limits<double>::quiet_NaN());
        }
    }
    metrics.meanIoU = validClasses > 0 ? iouSum / validClasses : 0.0;

    return metrics;
}

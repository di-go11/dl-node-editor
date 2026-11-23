#pragma once

struct EpochMetrics;
class IDatasetRepository;

class IModelTrainer
{
public:
    virtual ~IModelTrainer() = default;

    // 学習データを1周(1エポック)学習し、その間の集計結果を返す。
    // バッチ分割・テンソル変換・train モード設定は実装側の責務。
    // IModelEvaluator::evaluate と対称(どちらも「データセット1周」の粒度)。
    virtual EpochMetrics trainOneEpoch(IDatasetRepository &trainData, unsigned int nowEpoch) = 0;
};

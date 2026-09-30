#pragma once

// 監視するメトリクスの「良い方向」(Max / Min)。定義は Metrics 側に置く。
#include "training/entities/domain-objects/Metrics/MetricMode.hpp"

// これまでに観測した最良値を保持し、更新されたかどうかを判定する。
// TrainModelUsecase がベストモデルのチェックポイント保存を判断するために使う。
class BestMetricTracker
{
public:
    explicit BestMetricTracker(MetricMode mode);

    // 学習再開(resume)用。過去の run で記録したベスト値を引き継いで構築する。
    // これをしないと再開後の最初のエポックが「初回 = 常に improvement」扱いになり、
    // 過去のベストより悪いモデルで best チェックポイントを上書きしてしまう。
    BestMetricTracker(MetricMode mode, double initialBest);

    // value がこれまでのベストを更新したら true(初回は常に true)。
    // NaN は「更新なし」として false を返し、ベストも更新しない。
    bool update(double value);

    double best() const;
    bool hasBest() const;

private:
    MetricMode _mode;
    double _bestValue;
    bool _hasBest;
};

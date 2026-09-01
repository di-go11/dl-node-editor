#pragma once

#include <vector>

// 1エポック分の集計結果(train / validation 共通)。libtorch には依存しない純粋なデータ。
struct EpochMetrics
{
    double loss = 0.0;          // データセット全体の平均 loss(ピクセル単位)
    double pixelAccuracy = 0.0; // 正解ピクセル / 総ピクセル
    double meanIoU = 0.0;       // クラスごとの IoU の平均(有効クラスのみ)
    std::vector<double> perClassIoU; // クラスごとの IoU(分母0のクラスは NaN)
};

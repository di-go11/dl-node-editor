#pragma once

#include <vector>

// 1エポック分の集計結果(train / validation 共通)。libtorch には依存しない純粋なデータ。
struct EpochMetrics
{
    double loss = 0.0;               // データセット全体の平均 loss(ピクセル単位): Min
    double pixelAccuracy = 0.0;      // 正解ピクセル / 総ピクセル : Max
    double meanIoU = 0.0;            // クラスごとの IoU の平均(有効クラスのみ) : Max
    std::vector<double> perClassIoU; // クラスごとの IoU(分母0のクラスは NaN) : Max
    double fwIoU = 0.0;              // クラスの出現頻度で重み付けしたIoU。「よく出るクラスの精度」を重視したいとき。: Max
    double meanClassIoU = 0.0;       // クラスごとのaccuracyを平均。: Max
};

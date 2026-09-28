#pragma once

#include "training/adapters/interfaces/ILoss.hpp"

#include <cstdint>

// Boundary Loss(https://arxiv.org/abs/1812.07032 を単純化したクラス別版)。
//
// クラス c ごとに正解マスクから符号付き距離マップ φ_c を作り(物体の外側は正、
// 内側は負、境界付近で0に近づく)、予測確率 p_c との積 Σ_c φ_c・p_c を
// 境界からの逸脱ペナルティとして使う。φ の計算はラベルのみから決まり微分不可能
// なので、前処理として(勾配を持たない)距離マップを作ってから予測確率と掛ける。
//
// 距離マップの計算には libtorch に無い distance transform が必要なため、
// 本プロジェクトが既に依存している OpenCV の cv::distanceTransform を使う
// (CPU 上でバッチ・クラスごとにループして計算する)。
class BoundaryLoss : public ILoss
{
public:
    BoundaryLoss(int numClasses, int64_t ignoreIndex = 255);
    void lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output) override;

private:
    // target([N,H,W] int64)から、クラスごとの符号付き距離マップ([N,C,H,W] float32,
    // predicted と同じ device/dtype)を作る。勾配は持たない(target 由来のため)。
    at::Tensor buildSignedDistanceMap(const at::Tensor &target, const at::Tensor &validMask) const;

    int _numClasses;
    int64_t _ignoreIndex;
};

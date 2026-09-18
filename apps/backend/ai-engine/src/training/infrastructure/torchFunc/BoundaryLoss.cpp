#include "training/infrastructure/torchFunc/BoundaryLoss.hpp"

#include <torch/torch.h>
#include <opencv2/imgproc.hpp>

#include <cstring>

namespace
{
// [H,W] の 0/1 マスク(bool/uint8等)を、cv::distanceTransform が扱える
// CV_8UC1(値は0か255)の cv::Mat に変換する(CPU 上にコピーする)。
cv::Mat maskToCvMat255(const at::Tensor &binaryMask2d)
{
    at::Tensor cpuMask = (binaryMask2d.to(torch::kCPU, torch::kUInt8) * 255).contiguous();
    cv::Mat mat(static_cast<int>(cpuMask.size(0)), static_cast<int>(cpuMask.size(1)), CV_8UC1);
    std::memcpy(mat.data, cpuMask.data_ptr<uint8_t>(), static_cast<size_t>(cpuMask.numel()));
    return mat;
}

// distanceTransform の出力(CV_32F, [H,W])を at::Tensor([H,W] float32)にコピーする。
at::Tensor cvMat32FToTensor(const cv::Mat &mat)
{
    return torch::from_blob(mat.data, {mat.rows, mat.cols}, torch::kFloat32).clone();
}

// 物体マスク(0/255)から符号付き距離マップを作る。
// 物体の外側は正の距離、内側は負の距離、境界付近で0に近づく。
cv::Mat signedDistanceMat(const cv::Mat &objectMask)
{
    cv::Mat insideDist;
    cv::distanceTransform(objectMask, insideDist, cv::DIST_L2, cv::DIST_MASK_PRECISE);

    cv::Mat backgroundMask;
    cv::bitwise_not(objectMask, backgroundMask);

    cv::Mat outsideDist;
    cv::distanceTransform(backgroundMask, outsideDist, cv::DIST_L2, cv::DIST_MASK_PRECISE);

    return outsideDist - insideDist;
}
} // namespace

BoundaryLoss::BoundaryLoss(const int numClasses, const int64_t ignoreIndex)
    : _numClasses(numClasses), _ignoreIndex(ignoreIndex)
{
}

at::Tensor BoundaryLoss::buildSignedDistanceMap(const at::Tensor &target, const at::Tensor &validMask) const
{
    at::Tensor safeTarget = target.clone();
    safeTarget.masked_fill_(~validMask, 0);
    at::Tensor safeTargetCpu = safeTarget.to(torch::kCPU, torch::kInt64).contiguous();

    const int64_t batchSize = safeTargetCpu.size(0);
    const int64_t height = safeTargetCpu.size(1);
    const int64_t width = safeTargetCpu.size(2);

    at::Tensor distanceMap = torch::empty({batchSize, _numClasses, height, width}, torch::kFloat32);

    for (int64_t n = 0; n < batchSize; ++n)
    {
        at::Tensor sampleTarget = safeTargetCpu[n]; // [H,W]
        for (int c = 0; c < _numClasses; ++c)
        {
            at::Tensor objectMask2d = (sampleTarget == c); // [H,W] bool
            cv::Mat objectMat = maskToCvMat255(objectMask2d);
            cv::Mat signedDist = signedDistanceMat(objectMat);
            distanceMap[n][c] = cvMat32FToTensor(signedDist);
        }
    }

    return distanceMap;
}

void BoundaryLoss::lossOut(const at::Tensor &predicted, const at::Tensor &target, at::Tensor &output)
{
    at::Tensor validMask = (target != _ignoreIndex); // [N,H,W] bool

    at::Tensor distanceMap = buildSignedDistanceMap(target, validMask).to(predicted.device(), predicted.dtype());

    at::Tensor perPixelLoss = (distanceMap * predicted).sum(1); // [N,H,W]

    at::Tensor maskedLoss = perPixelLoss * validMask.to(perPixelLoss.dtype());
    output = maskedLoss.sum() / validMask.sum().to(maskedLoss.dtype()).clamp_min(1.0);
}

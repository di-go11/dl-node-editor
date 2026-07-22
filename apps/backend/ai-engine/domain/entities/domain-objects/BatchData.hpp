#include <vector>
#include "ImageData.hpp"

struct BatchData
{
    std::vector<ImageData> values; // バッチ内の各サンプルのデータ
    int num_samples;               // バッチ内のサンプル数
};
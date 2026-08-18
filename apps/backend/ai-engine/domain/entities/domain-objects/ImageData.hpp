#include <vector>
#include <cstddef>

struct ImageData
{
    std::vector<size_t> shape; // 1サンプル分の形状。例: {channels, height, width}
    std::vector<float> values; // 1サンプル分のデータ
};

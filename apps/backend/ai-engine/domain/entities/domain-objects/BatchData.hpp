#include <cstddef>
#include <vector>

struct BatchData
{
    std::vector<size_t> shape;
    std::vector<std::vector<float>> values; // [[data1], [data2], ...] 2次元配列でバッチ数分のデータを持つ
    int num_samples;
    BatchData(const std::vector<size_t> &shape, const std::vector<std::vector<float>> &values, int samples)
        : shape(shape), values(values), num_samples(samples) {}
};
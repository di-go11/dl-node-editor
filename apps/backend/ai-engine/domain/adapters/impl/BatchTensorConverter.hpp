#include <torch/torch.h>

#include <cstddef>
#include <vector>

class BatchData;

class BatchTensorConverter
{
public:
    torch::Tensor convert(const BatchData &batchData) const;

private:
    static std::vector<float> flattenValues(const BatchData &batchData);
    static std::vector<int64_t> resolveShape(const BatchData &batchData, std::size_t valueCount);
};
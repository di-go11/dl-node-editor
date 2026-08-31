#include "training/infrastructure/dataset/VocDatasetRepository.hpp"
#include "training/infrastructure/dataset/LabelMapFileReader.hpp"
#include "training/entities/domain-objects/BatchData.hpp"
#include "training/entities/domain-objects/TrainingBatch.hpp"
#include "training/entities/domain-objects/TrainParam.hpp"
#include "training/application/impl/image/ImageNormalizer.hpp"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <utility>

namespace fs = std::filesystem;

VocDatasetRepository::VocDatasetRepository(
    const std::string &datasetRoot,
    const std::shared_ptr<IImageDecoder> &decoder,
    const std::shared_ptr<IImagePreprocessor> &imagePreProcessor,
    const std::shared_ptr<IImagePreprocessor> &maskPreProcessor,
    const std::shared_ptr<TrainParam> &trainParam)
    : _datasetRoot(datasetRoot),
      _decoder(decoder),
      _imagePreProcessor(imagePreProcessor),
      _maskPreProcessor(maskPreProcessor),
      _labelConverter(LabelMapFileReader{}.read((fs::path(datasetRoot) / "labelmap.txt").string())),
      _batchSize(static_cast<int>(trainParam->getBatchSize())),
      _currentIndex(0)
{
    const std::string listPath = (fs::path(_datasetRoot) / "ImageSets" / "Segmentation" / "train.txt").string();
    _imageIds = loadImageIds(listPath);
}

std::vector<std::string> VocDatasetRepository::loadImageIds(const std::string &listFilePath)
{
    std::ifstream file(listFilePath);
    if (!file.is_open())
    {
        throw std::runtime_error("Could not open VOC image list: " + listFilePath);
    }

    std::vector<std::string> ids;
    std::string line;
    while (std::getline(file, line))
    {
        const auto start = line.find_first_not_of(" \t\r\n");
        if (start == std::string::npos)
        {
            continue; // 空行は無視
        }
        const auto end = line.find_last_not_of(" \t\r\n");
        ids.push_back(line.substr(start, end - start + 1));
    }
    return ids;
}

void VocDatasetRepository::reset()
{
    _currentIndex = 0;
}

bool VocDatasetRepository::hasNext() const
{
    return _currentIndex < _imageIds.size();
}

namespace
{
    // JPEGImagesの拡張子はデータセットによって .jpg/.jpeg のどちらもあり得るため、
    // 実在するファイルを探して解決する
    std::string resolveImagePath(const fs::path &jpegImagesDir, const std::string &id)
    {
        for (const char *ext : {".jpg", ".jpeg"})
        {
            fs::path candidate = jpegImagesDir / (id + ext);
            if (fs::exists(candidate))
            {
                return candidate.string();
            }
        }
        throw std::runtime_error("Could not find image file for id: " + id + " (tried .jpg/.jpeg under " + jpegImagesDir.string() + ")");
    }
} // namespace

TrainingBatch VocDatasetRepository::getNextBatch()
{
    TrainingBatch batch;

    const size_t end = std::min(_currentIndex + static_cast<size_t>(_batchSize), _imageIds.size());

    for (size_t i = _currentIndex; i < end; ++i)
    {
        const std::string &id = _imageIds[i];

        const std::string imagePath = resolveImagePath(fs::path(_datasetRoot) / "JPEGImages", id);
        const std::string maskPath = (fs::path(_datasetRoot) / "SegmentationClassP" / (id + ".png")).string();

        ImageData image = _decoder->decode(imagePath);
        ImageData colorMask = _decoder->decode(maskPath);
        ImageData classMask = _labelConverter.convert(colorMask);

        // リサイズは uint8 の ImageData に対して行い、その後で入力だけ正規化する。
        ImageData resizedImage = _imagePreProcessor->process(image);
        ImageData resizedMask = _maskPreProcessor->process(classMask);

        batch.input.values.push_back(ImageNormalizer::normalize(resizedImage)); // → NormalizedImageData
        batch.target.values.push_back(std::move(resizedMask));                  // ImageData のまま
    }

    batch.input.num_samples = static_cast<int>(batch.input.values.size());
    batch.target.num_samples = static_cast<int>(batch.target.values.size());

    _currentIndex = end;

    return batch;
}

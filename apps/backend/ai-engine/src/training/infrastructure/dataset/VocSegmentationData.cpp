#include "training/infrastructure/dataset/VocSegmentationData.hpp"

#include <filesystem>
#include <fstream>
#include <stdexcept>
#include <string>
#include <utility>

namespace fs = std::filesystem;

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

VocSegmentationData::VocSegmentationData(const std::string &datasetRoot,
                                         const std::shared_ptr<IImageDecoder> &decoder,
                                         const ColorLabelMap &labelMap,
                                         DatasetSplit split,
                                         uint8_t ignoreIndex,
                                         std::optional<RgbColor> ignoreColor) : _datasetRoot(datasetRoot),
                                                                                _decoder(decoder),
                                                                                _labelConverter(labelMap, ignoreIndex, std::move(ignoreColor))
{
    const char *listName = nullptr;
    switch (split)
    {
    case DatasetSplit::Train:
        listName = "train.txt";
        break;
    case DatasetSplit::Validation:
        listName = "val.txt";
        break;
    case DatasetSplit::Test:
        listName = "test.txt";
        break;
    default:
        throw std::invalid_argument("Invalid DatasetSplit value");
    }
    const std::string listPath = (fs::path(_datasetRoot) / "ImageSets" / "Segmentation" / listName).string();
    _imageIds = loadImageIds(listPath);
}

std::vector<std::string> VocSegmentationData::loadImageIds(const std::string &listFilePath)
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

size_t VocSegmentationData::size() const
{
    return _imageIds.size();
}

ImageData VocSegmentationData::getImage(size_t index) const
{
    const std::string &id = _imageIds.at(index);
    return _decoder->decode(resolveImagePath(fs::path(_datasetRoot) / "JPEGImages", id));
}

ImageData VocSegmentationData::getMask(size_t index) const
{
    const std::string &id = _imageIds.at(index);
    const auto maskPath = (fs::path(_datasetRoot) / "SegmentationClass" / (id + ".png")).string();
    const ImageData colorMask = _decoder->decode(maskPath);
    try
    {
        return _labelConverter.convert(colorMask); // カラー → クラスID
    }
    catch (const UnknownMaskColorError &e)
    {
        // 変換器はファイルを知らないので、どのマスクかをここで足す。
        throw UnknownMaskColorError(std::string(e.what()) + ": " + maskPath);
    }
}
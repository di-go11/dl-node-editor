#include "training/infrastructure/dataset/LabelMapFileReader.hpp"

#include "training/entities/image/RgbColor.hpp"

#include <array>
#include <cstdint>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>

namespace
{
    std::string trim(const std::string &str)
    {
        const char *whitespace = " \t\r\n\f\v";
        const auto start = str.find_first_not_of(whitespace);
        if (start == std::string::npos)
        {
            return "";
        }
        const auto end = str.find_last_not_of(whitespace);
        return str.substr(start, end - start + 1);
    }

    // "12,34,56" を RgbColor へ。値域(0-255)・要素数(3)を検証する。
    RgbColor parseRgb(const std::string &field, const std::string &line)
    {
        std::array<int, 3> channels{};
        std::stringstream stream(field);
        std::string token;

        for (int i = 0; i < 3; ++i)
        {
            if (!std::getline(stream, token, ','))
            {
                throw std::runtime_error("labelmap: RGB must have 3 components: " + line);
            }

            token = trim(token);
            int value = 0;
            try
            {
                value = std::stoi(token);
            }
            catch (...)
            {
                throw std::runtime_error("labelmap: RGB component is not a number: " + line);
            }

            if (value < 0 || value > 255)
            {
                throw std::runtime_error("labelmap: RGB component out of range (0-255): " + line);
            }
            channels[i] = value;
        }

        if (std::getline(stream, token, ','))
        {
            throw std::runtime_error("labelmap: RGB has more than 3 components: " + line);
        }

        return RgbColor(
            static_cast<uint8_t>(channels[0]),
            static_cast<uint8_t>(channels[1]),
            static_cast<uint8_t>(channels[2]));
    }
} // namespace

bool LabelMapFileReader::parseLine(const std::string &rawLine, int classId, ColorLabelMap &out)
{
    const std::string line = trim(rawLine);
    if (line.empty() || line[0] == '#')
    {
        return false;
    }

    // label:R,G,B:parts:actions  ── 先頭2フィールドだけ使う。
    const auto firstColon = line.find(':');
    if (firstColon == std::string::npos)
    {
        throw std::runtime_error("labelmap: missing ':' separator: " + line);
    }

    const auto secondColon = line.find(':', firstColon + 1);
    const std::string rgbField = trim(line.substr(
        firstColon + 1,
        secondColon == std::string::npos ? std::string::npos : secondColon - firstColon - 1));

    if (rgbField.empty())
    {
        throw std::runtime_error("labelmap: empty color field: " + line);
    }

    out.addEntry(parseRgb(rgbField, line), classId);
    return true;
}

ColorLabelMap LabelMapFileReader::read(const std::string &labelMapPath) const
{
    std::ifstream file(labelMapPath);
    if (!file.is_open())
    {
        throw std::runtime_error("Could not open labelmap file: " + labelMapPath);
    }

    ColorLabelMap labelMap;
    std::string line;
    int nextClassId = 0;

    while (std::getline(file, line))
    {
        if (parseLine(line, nextClassId, labelMap))
        {
            ++nextClassId;
        }
    }

    if (labelMap.entryCount() == 0)
    {
        throw std::runtime_error("labelmap file has no entries: " + labelMapPath);
    }

    return labelMap;
}

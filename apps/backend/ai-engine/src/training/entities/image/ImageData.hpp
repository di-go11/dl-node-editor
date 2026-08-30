#pragma once

#include <vector>
#include <cstddef>
#include <cstdint>

class ImageData
{
public:
    ImageData(std::vector<size_t> shape, std::vector<uint8_t> values);

    size_t getChannels() const;
    size_t getHeight() const;
    size_t getWidth() const;

    uint8_t at(size_t channel, size_t y, size_t x) const; // コピーで返すことでオブジェクト内部の値を変更できないようにする。また, constであるためメンバの変更を禁止する。
    uint8_t &at(size_t channel, size_t y, size_t x);      // 参照で返すことでオブジェクト内部の値を変更できるようになる。

    const std::vector<uint8_t> &raw() const;  // ← ピクセル列(uint8_t)
    const std::vector<size_t> &shape() const; // ← 形状(size_t)

private:
    size_t index(size_t channel, size_t y, size_t x) const;
    std::vector<size_t> _shape;   // const にしない(理由は下記)
    std::vector<uint8_t> _values; // CHW 平坦
};

#pragma once

#include "training/entities/segmentation/ColorLabelMap.hpp"

// PASCAL VOCの標準カラーパレット(21クラス: 0=background, 1-20=物体クラス)から
// ColorLabelMapを構築するファクトリ。labelmap.txt等の外部ファイルには依存しない。
class VocColorLabelMapFactory
{
public:
    static ColorLabelMap create();
};

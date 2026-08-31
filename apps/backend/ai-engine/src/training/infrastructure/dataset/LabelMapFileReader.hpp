#pragma once

#include <string>

#include "training/entities/image/ColorLabelMap.hpp"

// CVAT / PASCAL VOC devkit 形式の labelmap.txt を読み、ColorLabelMap を構築する。
//   行フォーマット: label:R,G,B:parts:actions
//   - '#' 始まりの行・空行は無視
//   - クラスID はファイルの出現順に 0,1,2,... を付与
class LabelMapFileReader
{
public:
    // 読み込み失敗・フォーマット不正時は std::runtime_error を投げる。
    ColorLabelMap read(const std::string &labelMapPath) const;

private:
    // "label:12,34,56:..." の1行を out に反映する。
    // 空行・コメント行なら false(classId を消費しない)。
    static bool parseLine(const std::string &line, int classId, ColorLabelMap &out);
};

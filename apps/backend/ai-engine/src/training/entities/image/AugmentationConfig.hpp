#pragma once

// segmentation の train 用データ拡張(幾何変換)の設定。
// 段階 2 では画面から設定せず、既定値(true / 0.5 / 2.0)を固定値として使う。
// 固定値はここ 1 か所にだけ書く(設定項目にするときは、ImageSpec から読んだ値で置き換える)。
struct AugmentationConfig
{
    bool horizontalFlip = true; // true なら、サンプルごとに確率 0.5 で左右反転する
    float scaleMin = 0.5f;      // 拡大縮小の倍率の下限
    float scaleMax = 2.0f;      // 拡大縮小の倍率の上限
};

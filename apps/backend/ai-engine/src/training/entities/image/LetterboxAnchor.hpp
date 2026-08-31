#pragma once

enum class LetterboxAnchor
{
    Center,  // 上下(または左右)に均等パディング。デフォルト
    TopLeft, // 余白を右・下にまとめる
};

// 一旦この2つにしておく、将来的に任意で余白の比率を決めたい場合は数値を入れられるように変更する。
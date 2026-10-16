#pragma once

// 入力をチャンネル方向に並べる処理(U-Net の skip connection など)。テンソル内の情報は混ざらない。
// 結合する次元はチャンネルに固定しているので、パラメータは持たない。
// (結合する次元をテンソルの何番目に当たるかへ変換するのは infrastructure 側の役目)
struct ConcatSpec
{
};

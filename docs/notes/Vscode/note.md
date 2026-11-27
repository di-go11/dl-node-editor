# 覚えておくと便利な機能忘備録

## workspace関連

workspaceを使うことでエディターをテンプレート的に保存することができ、vscodeをworkspaceから開くとそのテンプレートが適応されてエディタが開かれる。今こんな感じでworkspaceを使っている。

```json
{
  "folders": [
    {
      "path": ".",
    },
    {
      "path": "../../../docs/issues",
      "name": "issues",
    },
    {
      "path": "../../../docs/notes",
      "name": "notes",
    },
    {
      "path": "../proto",
      "name": "proto",
    },
  ],
  "settings": {
    "remote.autoForwardPortsFallback": 0,
  },
}
```

- `folders`にブロックごとまとめておくとエディタ内でrootより上のディレクトリがエクスプローラ上に表示される。これ便利。
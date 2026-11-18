use entities::dataset::DatasetId;
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
};
use usecases::dataset::{error::DatasetError, ports::DatasetSaver};
use zip::ZipArchive;

use super::error::FileError;
use tokio::task::spawn_blocking;

#[derive(Debug, Clone)]
pub struct FileDatasetSaver {
    dataset_root: PathBuf,
    max_extracted_bytes: u64,
}

impl FileDatasetSaver {
    pub fn new(dataset_root: PathBuf, max_extracted_bytes: u64) -> Self {
        Self {
            dataset_root,
            max_extracted_bytes,
        }
    }
    fn save_archive(&self, zip_path: &Path, id: &str) -> Result<PathBuf, FileError> {
        let staging = self.dataset_root.join(format!(".tmp-{id}"));
        let final_dir = self.dataset_root.join(id);

        fs::create_dir_all(&staging)?;
        let result = extract_zip(zip_path, &staging, &self.max_extracted_bytes).and_then(|()| {
            let content_root = single_child_dir(&staging)?.unwrap_or_else(|| staging.clone());
            fs::rename(&content_root, &final_dir)?;
            Ok(())
        });
        // 正規化: 直下がディレクトリ1つだけならその中身をデータセットのルートとみなす

        let _ = fs::remove_dir_all(&staging); //空になった外側の.tmp-<id>を片付ける
        result.map(|()| final_dir) // どっちのケースでも/data/datasets/<id>がルートになる。
    }
}

impl DatasetSaver for FileDatasetSaver {
    async fn save(&self, zip_path: &Path, dataset_id: &DatasetId) -> Result<PathBuf, DatasetError> {
        let saver = self.clone();
        // spawn_blockingは別スレッドで動くため借用ではなく所有した値をmoveさせる必要がある。つまり、.to_string()やpathBudにしてコピーさせるということ.
        let id = dataset_id.as_str().to_string();
        let zip_path = zip_path.to_path_buf();
        spawn_blocking(move || saver.save_archive(&zip_path, &id))
            .await
            .map_err(|e| DatasetError::SaveFailed(e.to_string()))?
            .map_err(DatasetError::from) // 大きなファイルをupload中にAPIが止まらないように隔離されたスレッドで実行する。
    }
}

// 内部関数は FileError を返し、DatasetError への変換はポート実装の出口で1回だけ行う
fn extract_zip(zip_path: &Path, dest: &Path, max_extracted_bytes: &u64) -> Result<(), FileError> {
    // ?でFrom::fromを呼び出してくれるため、?をつけるだけでいい(io::Error → FileError::Io)
    let file = File::open(zip_path)?;
    // ZipError → FileError::UnzipFailed
    let mut archive = ZipArchive::new(file)?;

    let mut written: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;

        // Zip Slip 対策: dest の外を指すパス・絶対パスは None になる
        let rel = entry.enclosed_name().ok_or_else(|| {
            FileError::UnsafePath(String::from_utf8_lossy(entry.name_raw()).into_owned())
        })?;
        let out_path = dest.join(rel);

        // シンボリックリンクはデータセットに不要なので無視(リンク経由で外へ書く攻撃も防げる)
        if entry.is_symlink() {
            continue;
        }

        // ディレクトリならそのまま作って次へ
        if entry.is_dir() {
            fs::create_dir_all(&out_path)?;
            continue;
        }

        // ファイルなら親ディレクトリを作っておく(zip 内でディレクトリのエントリが省略されることがあるため)
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        // 中身をコピー。残り容量 + 1 バイトまでしか読まないようにする
        let mut out = File::create(&out_path)?;
        let max_extracted_bytes = max_extracted_bytes.clone();
        let remaining = max_extracted_bytes - written;
        written += io::copy(&mut (&mut entry).take(remaining + 1), &mut out)?;
        if written > max_extracted_bytes {
            return Err(FileError::TooLarge);
        }
    }
    Ok(())
}

// dirの直下がディレクトリ1つだけならそのパスを返す。
fn single_child_dir(dir: &Path) -> Result<Option<PathBuf>, FileError> {
    let mut entries = fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
    if entries.len() == 1 && entries[0].file_type()?.is_dir() {
        Ok(Some(entries.remove(0).path()))
    } else {
        Ok(None)
    }
}

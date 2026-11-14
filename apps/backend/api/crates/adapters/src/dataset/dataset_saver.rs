use chrono::offset::LocalResult::Single;
use entities::dataset::DatasetId;
use futures_util::future::ok;
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
};
use tonic::Code::Ok;
use usecases::dataset::{error::DatasetError, ports::DatasetSaver};
use zip::ZipArchive;

use super::super::utils::uuid_generator::generate_uuid;
use super::error::FileError;
use super::sql::SqliteDatasetRepository;

const MAX_TOTAL_SIZE: u64 = 1024 * 1024 * 1024 * 1024; // 1TBまでしか解凍できないようにする。

// 内部関数は FileError を返し、DatasetError への変換はポート実装の出口で1回だけ行う
fn extract_zip(zip_path: &Path, dest: &Path) -> Result<(), FileError> {
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
        let remaining = MAX_TOTAL_SIZE - written;
        written += io::copy(&mut (&mut entry).take(remaining + 1), &mut out)?;
        if written > MAX_TOTAL_SIZE {
            return Err(FileError::TooLarge);
        }
    }
    Ok(())
}

fn save_archive(zip_path: &Path, root: &Path, id: &str) -> Result<PathBuf, FileError> {
    let staging = root.join(format!(".tmp-{id}"));
    let final_dir = root.join(id);

    fs::create_dir_all(&staging)?;
    if let Err(e) = extract_zip(zip_path, &staging) {
        let _ = fs::remove_dir_all(&staging);
        return Err(e);
    }
    // 正規化: 直下がディレクトリ1つだけならその中身をデータセットのルートとみなす

    let content_root = single_child_dir(&staging)?.unwrap_or_else(|| staging.clone());
    if content_root != staging {
        let _ = fs::remove_dir_all(&staging); //空になった外側の.tmp-<id>を片付ける
    }
    Ok(final_dir) // どっちのケースでも/data/datasets/<id>がルートになる。
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

#[derive(Debug)]
struct FileDatasetSaver {
    dataset_root: PathBuf,
}

impl FileDatasetSaver {
    pub fn new(dataset_root: PathBuf) -> Self {
        Self { dataset_root }
    }
}

impl DatasetSaver for FileDatasetSaver {
    async fn save(&self, zip_path: &Path, dataset_id: &DatasetId) -> Result<PathBuf, DatasetError> {
        let id = dataset_id.as_str();
        save_archive(zip_path, &self.dataset_root, id).map_err(|e| DatasetError::from(e))
    }
}

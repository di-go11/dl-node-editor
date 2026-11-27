use entities::dataset::{DatasetId, RequiredEntry};
use std::{
    fs::{self, File},
    io::{self, Read},
    path::{Path, PathBuf},
};
use usecases::dataset::{
    error::DatasetError,
    ports::{DatasetLayoutChecker, DatasetSaver},
};
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

    async fn discard(&self, dataset_path: &Path) -> Result<(), DatasetError> {
        // 置き場の外を消さないよう、dataset_root の直下だけを消す
        if dataset_path.parent() != Some(self.dataset_root.as_path()) {
            return Err(DatasetError::SaveFailed(format!(
                "refusing to remove a path outside the dataset root: {}",
                dataset_path.display()
            )));
        }
        tokio::fs::remove_dir_all(dataset_path)
            .await
            .map_err(|e| DatasetError::from(FileError::Io(e)))
    }
}

impl DatasetLayoutChecker for FileDatasetSaver {
    async fn find_missing(
        &self,
        dataset_path: &Path,
        required: &[RequiredEntry],
    ) -> Result<Vec<RequiredEntry>, DatasetError> {
        let mut missing = Vec::new();
        for entry in required {
            // 無いもの・種類が違うもの(ディレクトリのはずがファイル等)は「足りない」とする
            let present = match tokio::fs::metadata(dataset_path.join(entry.path())).await {
                Ok(meta) => match entry {
                    RequiredEntry::Dir(_) => meta.is_dir(),
                    RequiredEntry::File(_) => meta.is_file(),
                },
                Err(e) if e.kind() == io::ErrorKind::NotFound => false,
                Err(e) => return Err(DatasetError::from(FileError::Io(e))),
            };
            if !present {
                missing.push(*entry);
            }
        }
        Ok(missing)
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
        let max_extracted_bytes = *max_extracted_bytes;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::utils::uuid_generator::generate_uuid;

    // テストごとに別のデータセット置き場を作る
    fn fresh_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("dataset-saver-test-{}", generate_uuid()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[tokio::test]
    async fn find_missing_reports_absent_and_wrong_kind_entries() {
        let root = fresh_root();
        let dataset = root.join("ds");
        fs::create_dir_all(dataset.join("JPEGImages")).unwrap();
        fs::create_dir_all(dataset.join("ImageSets/Segmentation")).unwrap();
        fs::write(dataset.join("ImageSets/Segmentation/train.txt"), "a\n").unwrap();
        // ディレクトリであるべき SegmentationClass がファイルになっている
        fs::write(dataset.join("SegmentationClass"), "").unwrap();
        let saver = FileDatasetSaver::new(root.clone(), 1024);

        let missing = saver
            .find_missing(
                &dataset,
                &[
                    RequiredEntry::Dir("JPEGImages"),
                    RequiredEntry::Dir("SegmentationClass"),
                    RequiredEntry::File("ImageSets/Segmentation/train.txt"),
                    RequiredEntry::File("labelmap.txt"),
                ],
            )
            .await
            .unwrap();

        assert_eq!(
            missing,
            vec![
                RequiredEntry::Dir("SegmentationClass"),
                RequiredEntry::File("labelmap.txt"),
            ]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn discard_removes_dataset_under_root_only() {
        let root = fresh_root();
        let dataset = root.join("ds");
        fs::create_dir_all(dataset.join("JPEGImages")).unwrap();
        let saver = FileDatasetSaver::new(root.clone(), 1024);

        // 置き場の直下でないパスは消さない
        assert!(saver.discard(&dataset.join("JPEGImages")).await.is_err());
        assert!(dataset.join("JPEGImages").is_dir());

        saver.discard(&dataset).await.unwrap();
        assert!(!dataset.exists());
        fs::remove_dir_all(root).unwrap();
    }
}

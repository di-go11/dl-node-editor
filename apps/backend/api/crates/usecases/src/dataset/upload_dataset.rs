use std::path::Path;

use entities::dataset::DatasetFormat;

use crate::dataset::{
    dataset_id_generator::DatasetIdGenerator,
    error::DatasetError,
    ports::{DatasetLayoutChecker, DatasetRegister, DatasetSaver, RegisterDatasetInput},
};

// S は保存(DatasetSaver)と構成の確認(DatasetLayoutChecker)の両方を受け持つ。
// どちらもデータセット置き場のファイルを扱うので、同じアダプタ(FileDatasetSaver)が実装する。
pub struct UploadDataset<G, S, R> {
    saver: S,
    register: R,
    id_generator: G,
}

impl<G: DatasetIdGenerator, S: DatasetSaver + DatasetLayoutChecker, R: DatasetRegister>
    UploadDataset<G, S, R>
{
    pub fn new(id_generator: G, saver: S, register: R) -> Self {
        Self {
            id_generator,
            saver,
            register,
        }
    }
    pub async fn execute(
        &self,
        zip_path: &Path,
        dataset_name: String,
        dataset_type: String,
    ) -> Result<(), DatasetError> {
        // 知らない形式なら、解凍する前に断る
        let format = DatasetFormat::parse(&dataset_type)
            .ok_or_else(|| DatasetError::UnknownFormat(dataset_type.clone()))?;

        let dataset_id = self.id_generator.generate_id();
        let dataset_path = self
            .saver
            .save(zip_path, &dataset_id)
            .await
            .map_err(|e| DatasetError::SaveFailed(e.to_string()))?;

        // 形式に必要なファイル構成になっているか。なっていなければ置いたものを消して、足りないものを返す
        let checked = self
            .saver
            .find_missing(&dataset_path, &format.required_entries())
            .await;
        let problem = match checked {
            Ok(missing) if missing.is_empty() => None,
            Ok(missing) => Some(DatasetError::LayoutMismatch {
                format: format.as_str().to_string(),
                missing: missing.iter().map(|entry| entry.display_name()).collect(),
            }),
            Err(e) => Some(e),
        };
        if let Some(error) = problem {
            // 消せなくても、利用者に返すべきなのは形式の問題の方なので、消す失敗は握りつぶす
            let _ = self.saver.discard(&dataset_path).await;
            return Err(error);
        }

        let dataset_config: RegisterDatasetInput = RegisterDatasetInput {
            dataset_id,
            dataset_name,
            dataset_type: format.as_str().to_string(),
            dataset_path: dataset_path.to_string_lossy().to_string(),
        };

        self.register
            .register(&dataset_config)
            .await
            .map_err(|e| DatasetError::RegisterFailed(e.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use entities::dataset::{DatasetId, RequiredEntry};
    use std::path::PathBuf;
    use std::sync::Mutex;

    struct FixedIdGenerator;
    impl DatasetIdGenerator for FixedIdGenerator {
        fn generate_id(&self) -> DatasetId {
            DatasetId::new("dataset-1").unwrap()
        }
    }

    // 置いたデータセットに無いもの(missing)を決めておけるフェイク。save / discard の呼び出しを記録する
    struct FakeSaver {
        missing: Vec<RequiredEntry>,
        calls: Mutex<Vec<String>>,
    }
    impl FakeSaver {
        fn new(missing: Vec<RequiredEntry>) -> Self {
            Self {
                missing,
                calls: Mutex::new(vec![]),
            }
        }
        fn calls(&self) -> Vec<String> {
            self.calls.lock().unwrap().clone()
        }
    }
    impl DatasetSaver for &FakeSaver {
        async fn save(
            &self,
            _tmp_path: &Path,
            dataset_id: &DatasetId,
        ) -> Result<PathBuf, DatasetError> {
            self.calls.lock().unwrap().push("save".to_string());
            Ok(PathBuf::from("/datasets").join(dataset_id.as_str()))
        }
        async fn discard(&self, dataset_path: &Path) -> Result<(), DatasetError> {
            self.calls
                .lock()
                .unwrap()
                .push(format!("discard {}", dataset_path.display()));
            Ok(())
        }
    }
    impl DatasetLayoutChecker for &FakeSaver {
        async fn find_missing(
            &self,
            _dataset_path: &Path,
            required: &[RequiredEntry],
        ) -> Result<Vec<RequiredEntry>, DatasetError> {
            // 求められていないものは「無い」と言わない
            Ok(self
                .missing
                .iter()
                .filter(|entry| required.contains(entry))
                .copied()
                .collect())
        }
    }

    #[derive(Default)]
    struct FakeRegister {
        registered: Mutex<Vec<(String, String)>>,
    }
    impl DatasetRegister for &FakeRegister {
        async fn register(&self, input: &RegisterDatasetInput) -> Result<(), DatasetError> {
            self.registered
                .lock()
                .unwrap()
                .push((input.dataset_type.clone(), input.dataset_path.clone()));
            Ok(())
        }
    }

    async fn upload(
        saver: &FakeSaver,
        register: &FakeRegister,
        dataset_type: &str,
    ) -> Result<(), DatasetError> {
        UploadDataset::new(FixedIdGenerator, saver, register)
            .execute(
                Path::new("/tmp/upload.zip"),
                "voc".to_string(),
                dataset_type.to_string(),
            )
            .await
    }

    #[tokio::test]
    async fn registers_dataset_with_required_layout() {
        let saver = FakeSaver::new(vec![]);
        let register = FakeRegister::default();

        upload(&saver, &register, "pascal_voc").await.unwrap();

        assert_eq!(saver.calls(), vec!["save"]);
        assert_eq!(
            *register.registered.lock().unwrap(),
            vec![("pascal_voc".to_string(), "/datasets/dataset-1".to_string())]
        );
    }

    #[tokio::test]
    async fn pascal_voc_does_not_require_labelmap() {
        // labelmap.txt が無くても、pascal_voc なら登録できる(本家 VOC の配布物には無い)
        let saver = FakeSaver::new(vec![RequiredEntry::File("labelmap.txt")]);
        let register = FakeRegister::default();

        upload(&saver, &register, "pascal_voc").await.unwrap();

        assert_eq!(register.registered.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn rejects_and_discards_when_layout_is_missing() {
        let saver = FakeSaver::new(vec![
            RequiredEntry::Dir("JPEGImages"),
            RequiredEntry::File("labelmap.txt"),
        ]);
        let register = FakeRegister::default();

        let result = upload(&saver, &register, "original").await;

        assert_eq!(
            result,
            Err(DatasetError::LayoutMismatch {
                format: "original".to_string(),
                missing: vec!["JPEGImages/".to_string(), "labelmap.txt".to_string()],
            })
        );
        // 置いたものは消し、登録はしない
        assert_eq!(saver.calls(), vec!["save", "discard /datasets/dataset-1"]);
        assert!(register.registered.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejects_unknown_format_before_saving() {
        let saver = FakeSaver::new(vec![]);
        let register = FakeRegister::default();

        let result = upload(&saver, &register, "coco").await;

        assert_eq!(result, Err(DatasetError::UnknownFormat("coco".to_string())));
        assert!(saver.calls().is_empty());
        assert!(register.registered.lock().unwrap().is_empty());
    }
}

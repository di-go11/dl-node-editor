use crate::training::{ProgressRecordingScheduler, RecordError, TrainingRecordReader};

pub struct ResumeProgressRecordings<R, K> {
    reader: R,
    scheduler: K,
}

impl<R: TrainingRecordReader, K: ProgressRecordingScheduler> ResumeProgressRecordings<R, K> {
    pub fn new(reader: R, scheduler: K) -> Self {
        Self { reader, scheduler }
    }
    pub async fn execute(&self) -> Result<usize, RecordError> {
        let ids = self.reader.find_running_job_ids().await?;
        let n = ids.len();
        for id in ids {
            self.scheduler.schedule(id);
        }
        Ok(n)
    }
}

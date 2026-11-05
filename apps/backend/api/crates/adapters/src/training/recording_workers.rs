use std::{collections::HashMap, eprintln, future::Future};

use tokio::{sync::mpsc, task::JoinSet};

use entities::training::JobId;
use usecases::training::ProgressRecordingScheduler;

// ProgressRecordingSchedulerからはSenderを使用する。Reciverは直接使わないため構造体では包まない
#[derive(Clone)]
pub struct ChannelRecordingScheduler {
    tx: mpsc::UnboundedSender<JobId>,
}

impl ProgressRecordingScheduler for ChannelRecordingScheduler {
    fn schedule(&self, job_id: JobId) {
        if let Err(e) = self.tx.send(job_id) {
            eprintln!("recording worker is not running {}", e.0.as_str());
        }
    }
}

// 送信者がStartTrainingとResumeProgressRecordingの2ヶ所なため
pub fn recording_channel() -> (ChannelRecordingScheduler, mpsc::UnboundedReceiver<JobId>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (ChannelRecordingScheduler { tx }, rx)
}

// 記録処理はクロージャで受け取る。
pub async fn run_recording_worker<F, Fut>(mut rx: mpsc::UnboundedReceiver<JobId>, record: F)
where
    F: Fn(JobId) -> Fut,
    Fut: Future<Output = ()> + Send + 'static,
{
    let mut tasks = JoinSet::new();
    let mut running: HashMap<task::Id, JobId> = HashMap::new();
    loop {
        tokio::select! {
            Some(job_id) = rx.recv() => {
                if running.values().any(|j| j == &job_id) { continue; } // 二重起動を防ぐ
                let handle = tasks.spawn(record(job_id.clone()));
                running.insert(handle.id(), job_id);
            }
            Some(res) = tasks.join_next_with_id() => {
                // panic で終わったタスクも running から外す
                let id = match res { Ok((id, ())) => id, Err(e) => e.id() };
                running.remove(&id);
            }
            else => break,
        }
    }
}

use crate::transport::NativeTransport;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use modpacks_migrator_core::{
    Analysis, ArtifactStore, Engine, Error, Limits, MigrationReport, Progress, Provider,
    Resolution, ResolveRequest, Target, analyze_archive_with_progress,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::File,
    io::{Read, Write},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tempfile::TempDir;
use tokio::{io::AsyncWriteExt, sync::Semaphore};
use tokio_util::io::ReaderStream;

const JOB_TTL: Duration = Duration::from_secs(30 * 60);
const MAX_JOBS: usize = 4;

type ApiResult<T> = Result<T, ApiError>;

pub struct ApiError(StatusCode, String);
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
impl From<Error> for ApiError {
    fn from(value: Error) -> Self {
        Self(StatusCode::BAD_REQUEST, value.to_string())
    }
}
impl From<std::io::Error> for ApiError {
    fn from(_: std::io::Error) -> Self {
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Temporary storage operation failed".into(),
        )
    }
}

struct JobData {
    state: String,
    revision: u64,
    progress: Option<Progress>,
    analysis: Option<Analysis>,
    resolution: Option<Resolution>,
    report: Option<MigrationReport>,
    error: Option<String>,
    busy: bool,
    touched: Instant,
}
struct Job {
    id: String,
    dir: TempDir,
    data: Mutex<JobData>,
    cancelled: Arc<AtomicBool>,
}
#[derive(Clone)]
pub struct AppState {
    jobs: Arc<Mutex<HashMap<String, Arc<Job>>>>,
    slots: Arc<Semaphore>,
    transport: NativeTransport,
    key: Option<String>,
    limits: Limits,
}

pub fn router(key: Option<String>, max_upload: u64) -> Result<Router, Error> {
    let state = AppState {
        jobs: Arc::new(Mutex::new(HashMap::new())),
        slots: Arc::new(Semaphore::new(2)),
        transport: NativeTransport::new()?,
        key,
        limits: Limits {
            max_input_bytes: max_upload,
            ..Limits::default()
        },
    };
    let cleanup = state.clone();
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(60));
        loop {
            timer.tick().await;
            cleanup.jobs.lock().unwrap().retain(|_, job| {
                let data = job.data.lock().unwrap();
                data.busy || data.touched.elapsed() < JOB_TTL
            });
        }
    });
    Ok(Router::new()
        .route("/api/v1/analyze", post(analyze))
        .route("/api/v1/resolve", post(resolve))
        .route("/api/v1/convert", post(convert_upload))
        .route("/api/v1/jobs/{id}", get(status))
        .route("/api/v1/jobs/{id}/preview", get(preview))
        .route("/api/v1/jobs/{id}/report", get(report))
        .route("/api/v1/jobs/{id}/download", get(download))
        .route("/api/v1/jobs/{id}/convert", post(convert_existing))
        .route("/api/v1/jobs/{id}/cancel", post(cancel))
        .route("/api/v1/search", get(search))
        .route("/api/v1/candidates", get(candidates))
        .layer(DefaultBodyLimit::max(
            max_upload.saturating_add(1024 * 1024) as usize,
        ))
        .with_state(state))
}

impl AppState {
    fn get(&self, id: &str) -> ApiResult<Arc<Job>> {
        let job =
            self.jobs.lock().unwrap().get(id).cloned().ok_or_else(|| {
                ApiError(StatusCode::NOT_FOUND, "Job not found or expired".into())
            })?;
        job.data.lock().unwrap().touched = Instant::now();
        Ok(job)
    }
    fn create(&self) -> ApiResult<Arc<Job>> {
        let mut jobs = self.jobs.lock().unwrap();
        if jobs.len() >= MAX_JOBS {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "Too many retained jobs; wait for expiration".into(),
            ));
        }
        let job = Arc::new(Job {
            id: uuid::Uuid::new_v4().to_string(),
            dir: tempfile::tempdir()?,
            cancelled: Arc::new(AtomicBool::new(false)),
            data: Mutex::new(JobData {
                state: "uploading".into(),
                revision: 0,
                progress: None,
                analysis: None,
                resolution: None,
                report: None,
                error: None,
                busy: false,
                touched: Instant::now(),
            }),
        });
        jobs.insert(job.id.clone(), job.clone());
        Ok(job)
    }
}

async fn upload(
    state: &AppState,
    mut multipart: Multipart,
) -> ApiResult<(Arc<Job>, Option<ResolveRequest>)> {
    let job = state.create()?;
    let result: ApiResult<Option<ResolveRequest>> = async {
        let mut found = false;
        let mut options = None;
        while let Some(mut field) = multipart
            .next_field()
            .await
            .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Invalid multipart upload".into()))?
        {
            match field.name() {
                Some("archive") => {
                    if found {
                        return Err(ApiError(
                            StatusCode::BAD_REQUEST,
                            "Only one archive is accepted".into(),
                        ));
                    }
                    found = true;
                    let mut file =
                        tokio::fs::File::create(job.dir.path().join("source.zip")).await?;
                    let mut size = 0u64;
                    while let Some(chunk) = field.chunk().await.map_err(|_| {
                        ApiError(StatusCode::BAD_REQUEST, "Upload interrupted".into())
                    })? {
                        size = size.saturating_add(chunk.len() as u64);
                        if size > state.limits.max_input_bytes {
                            return Err(ApiError(
                                StatusCode::PAYLOAD_TOO_LARGE,
                                "Archive exceeds upload limit".into(),
                            ));
                        }
                        file.write_all(&chunk).await?;
                    }
                    file.flush().await?;
                }
                Some("options") => {
                    let mut bytes = Vec::new();
                    while let Some(chunk) = field.chunk().await.map_err(|_| {
                        ApiError(StatusCode::BAD_REQUEST, "Invalid options field".into())
                    })? {
                        if bytes.len() + chunk.len() > 64 * 1024 {
                            return Err(ApiError(
                                StatusCode::PAYLOAD_TOO_LARGE,
                                "Options field is too large".into(),
                            ));
                        }
                        bytes.extend_from_slice(&chunk);
                    }
                    options = Some(serde_json::from_slice(&bytes).map_err(|_| {
                        ApiError(
                            StatusCode::BAD_REQUEST,
                            "Options must be a valid resolve request".into(),
                        )
                    })?);
                }
                _ => {
                    return Err(ApiError(
                        StatusCode::BAD_REQUEST,
                        "Expected archive and optional options fields".into(),
                    ));
                }
            }
        }
        if !found {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "Missing archive field".into(),
            ));
        }
        Ok(options)
    }
    .await;
    match result {
        Ok(options) => Ok((job, options)),
        Err(error) => {
            state.jobs.lock().unwrap().remove(&job.id);
            Err(error)
        }
    }
}

enum Work {
    Analyze,
    Resolve(ResolveRequest),
    Convert,
    All(ResolveRequest),
}

fn start(state: AppState, job: Arc<Job>, work: Work) -> ApiResult<Value> {
    let permit = state.slots.clone().try_acquire_owned().map_err(|_| {
        ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "All processing slots are busy".into(),
        )
    })?;
    {
        let mut data = job.data.lock().unwrap();
        if data.busy {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Job is already processing".into(),
            ));
        }
        data.busy = true;
        data.error = None;
        data.report = None;
        data.state = match &work {
            Work::Analyze | Work::All(_) => "analyzing",
            Work::Resolve(_) => "resolving",
            Work::Convert => "downloading",
        }
        .into();
    }
    job.cancelled.store(false, Ordering::Relaxed);
    let id = job.id.clone();
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build();
        let result = match runtime {
            Ok(runtime) => runtime.block_on(process(&state, &job, work)),
            Err(error) => Err(Error::Io(error)),
        };
        let mut data = job.data.lock().unwrap();
        data.busy = false;
        data.touched = Instant::now();
        if let Err(error) = result {
            data.state = if matches!(error, Error::Cancelled) {
                "cancelled"
            } else {
                "failed"
            }
            .into();
            data.error = Some(error.to_string());
            data.report = None;
            let _ = std::fs::remove_file(job.dir.path().join("result.zip"));
        }
    });
    Ok(json!({"jobId":id}))
}

async fn process(state: &AppState, job: &Job, work: Work) -> Result<(), Error> {
    let mut progress = |event: Progress| {
        if job.cancelled.load(Ordering::Relaxed) {
            return Err(Error::Cancelled);
        }
        let mut data = job.data.lock().unwrap();
        data.progress = Some(event);
        data.touched = Instant::now();
        Ok(())
    };
    if matches!(work, Work::Analyze | Work::All(_)) {
        let analysis = analyze_archive_with_progress(
            File::open(job.dir.path().join("source.zip"))?,
            &state.limits,
            &mut |done, total| {
                progress(Progress {
                    stage: "scanning".into(),
                    completed: done as u64,
                    total: total as u64,
                    message: "Reading archive entries".into(),
                })
            },
        )?;
        let mut data = job.data.lock().unwrap();
        data.analysis = Some(analysis);
        data.state = "analyzed".into();
    }
    let engine = Engine::new(
        state.transport.with_cancellation(job.cancelled.clone()),
        state.key.clone(),
        state.limits.clone(),
    );
    let convert = matches!(work, Work::Convert | Work::All(_));
    if let Work::Resolve(request) | Work::All(request) = work {
        let analysis = job
            .data
            .lock()
            .unwrap()
            .analysis
            .clone()
            .ok_or_else(|| Error::InvalidInput("Analyze the archive first".into()))?;
        let resolution = engine.resolve(&analysis, &request, &mut progress).await?;
        let mut data = job.data.lock().unwrap();
        data.resolution = Some(resolution);
        data.revision += 1;
        data.state = "preview_ready".into();
    }
    if convert {
        let resolution = job
            .data
            .lock()
            .unwrap()
            .resolution
            .clone()
            .ok_or_else(|| Error::InvalidInput("Resolve the archive first".into()))?;
        let mut store = DiskStore::new(
            job.dir
                .path()
                .join(format!("artifacts-{}", uuid::Uuid::new_v4())),
        )?;
        let output = File::create(job.dir.path().join("result.zip"))?;
        let report = engine
            .convert(&resolution, &mut store, output, &mut progress)
            .await?;
        let mut data = job.data.lock().unwrap();
        data.state = serde_json::to_value(report.status)?
            .as_str()
            .unwrap_or("completed")
            .to_owned();
        data.report = Some(report);
    }
    Ok(())
}

async fn analyze(
    State(state): State<AppState>,
    multipart: Multipart,
) -> ApiResult<impl IntoResponse> {
    let (job, _) = upload(&state, multipart).await?;
    match start(state.clone(), job.clone(), Work::Analyze) {
        Ok(value) => Ok((StatusCode::ACCEPTED, Json(value))),
        Err(error) => {
            state.jobs.lock().unwrap().remove(&job.id);
            Err(error)
        }
    }
}
async fn convert_upload(
    State(state): State<AppState>,
    multipart: Multipart,
) -> ApiResult<impl IntoResponse> {
    let (job, options) = upload(&state, multipart).await?;
    let Some(options) = options else {
        state.jobs.lock().unwrap().remove(&job.id);
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Conversion requires options with target".into(),
        ));
    };
    match start(state.clone(), job.clone(), Work::All(options)) {
        Ok(value) => Ok((StatusCode::ACCEPTED, Json(value))),
        Err(error) => {
            state.jobs.lock().unwrap().remove(&job.id);
            Err(error)
        }
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveBody {
    job_id: String,
    revision: Option<u64>,
    #[serde(flatten)]
    request: ResolveRequest,
}
async fn resolve(
    State(state): State<AppState>,
    Json(body): Json<ResolveBody>,
) -> ApiResult<impl IntoResponse> {
    let job = state.get(&body.job_id)?;
    {
        let data = job.data.lock().unwrap();
        if body.revision.is_some_and(|rev| rev != data.revision) {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Stale preview revision".into(),
            ));
        }
        if data.analysis.is_none() {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Analyze the archive first".into(),
            ));
        }
    }
    Ok((
        StatusCode::ACCEPTED,
        Json(start(state, job, Work::Resolve(body.request))?),
    ))
}
#[derive(Deserialize)]
struct Revision {
    revision: u64,
}
async fn convert_existing(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<Revision>,
) -> ApiResult<impl IntoResponse> {
    let job = state.get(&id)?;
    {
        let data = job.data.lock().unwrap();
        if body.revision != data.revision {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Stale preview revision".into(),
            ));
        }
        if data.resolution.is_none() {
            return Err(ApiError(
                StatusCode::CONFLICT,
                "Resolve the archive first".into(),
            ));
        }
    }
    Ok((
        StatusCode::ACCEPTED,
        Json(start(state, job, Work::Convert)?),
    ))
}
async fn status(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let job = state.get(&id)?;
    let data = job.data.lock().unwrap();
    Ok(Json(
        json!({"jobId":job.id,"state":data.state,"revision":data.revision,"progress":data.progress,"error":data.error,"analysis":data.analysis}),
    ))
}
async fn preview(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let job = state.get(&id)?;
    let data = job.data.lock().unwrap();
    let resolution = data
        .resolution
        .as_ref()
        .ok_or_else(|| ApiError(StatusCode::CONFLICT, "Preview is not ready".into()))?;
    Ok(Json(
        json!({"revision":data.revision,"resolution":resolution}),
    ))
}
async fn report(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let job = state.get(&id)?;
    let data = job.data.lock().unwrap();
    let report = data
        .report
        .as_ref()
        .ok_or_else(|| ApiError(StatusCode::CONFLICT, "Report is not ready".into()))?;
    Ok(Json(serde_json::to_value(report).map_err(Error::from)?))
}
async fn download(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Response> {
    let job = state.get(&id)?;
    if job.data.lock().unwrap().report.is_none() {
        return Err(ApiError(StatusCode::CONFLICT, "ZIP is not ready".into()));
    }
    let file = tokio::fs::File::open(job.dir.path().join("result.zip")).await?;
    Ok((
        [
            ("content-type", "application/zip"),
            (
                "content-disposition",
                "attachment; filename=\"migrated-modpack.zip\"",
            ),
        ],
        axum::body::Body::from_stream(ReaderStream::new(file)),
    )
        .into_response())
}
async fn cancel(State(state): State<AppState>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    let job = state.get(&id)?;
    job.cancelled.store(true, Ordering::Relaxed);
    state.jobs.lock().unwrap().remove(&id);
    Ok(Json(json!({"jobId":id,"state":"cancelled"})))
}
#[derive(Deserialize)]
struct Search {
    provider: Provider,
    query: String,
}
async fn search(
    State(state): State<AppState>,
    Query(query): Query<Search>,
) -> ApiResult<Json<Value>> {
    if query.query.len() > 256 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Search query is too long".into(),
        ));
    }
    let result = tokio::task::spawn_blocking(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(async {
            Engine::new(state.transport, state.key, state.limits)
                .search_projects(query.provider, &query.query)
                .await
        })
    })
    .await
    .map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Search task failed".into(),
        )
    })??;
    Ok(Json(serde_json::to_value(result).map_err(Error::from)?))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidates {
    provider: Provider,
    project_id: String,
    minecraft_version: String,
    loader: modpacks_migrator_core::Loader,
}
async fn candidates(
    State(state): State<AppState>,
    Query(query): Query<Candidates>,
) -> ApiResult<Json<Value>> {
    if query.project_id.len() > 128 {
        return Err(ApiError(
            StatusCode::BAD_REQUEST,
            "Project ID is too long".into(),
        ));
    }
    let result = tokio::task::spawn_blocking(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()?;
        runtime.block_on(async {
            Engine::new(state.transport, state.key, state.limits)
                .list_candidates(
                    query.provider,
                    &query.project_id,
                    &Target {
                        minecraft_version: query.minecraft_version,
                        loader: query.loader,
                    },
                )
                .await
        })
    })
    .await
    .map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Candidates task failed".into(),
        )
    })??;
    Ok(Json(serde_json::to_value(result).map_err(Error::from)?))
}

struct DiskStore {
    dir: std::path::PathBuf,
    files: HashMap<String, std::path::PathBuf>,
}
impl DiskStore {
    fn new(dir: std::path::PathBuf) -> Result<Self, Error> {
        std::fs::create_dir(&dir)?;
        Ok(Self {
            dir,
            files: HashMap::new(),
        })
    }
}
impl ArtifactStore for DiskStore {
    fn put(&mut self, key: &str, data: &[u8]) -> Result<(), Error> {
        let path = self.dir.join(self.files.len().to_string());
        let mut file = File::create(&path)?;
        file.write_all(data)?;
        self.files.insert(key.into(), path);
        Ok(())
    }
    fn open(&self, key: &str) -> Result<Box<dyn Read + '_>, Error> {
        let path = self
            .files
            .get(key)
            .ok_or_else(|| Error::InvalidInput("Staged artifact not found".into()))?;
        Ok(Box::new(File::open(path)?))
    }
}
impl Drop for DiskStore {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.dir) {
            eprintln!("Could not remove artifact staging directory: {error}");
        }
    }
}

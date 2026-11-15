use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Modrinth,
    Curseforge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Loader {
    Fabric,
    Forge,
    Neoforge,
    Quilt,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    Release,
    Beta,
    Alpha,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub minecraft_version: String,
    pub loader: Loader,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    pub input_id: String,
    #[serde(default)]
    pub exclude: bool,
    #[serde(default)]
    pub provider: Option<Provider>,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub version_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    pub target: Target,
    #[serde(default = "default_providers")]
    pub providers: Vec<Provider>,
    #[serde(default = "default_true")]
    pub include_dependencies: bool,
    #[serde(default = "default_channels")]
    pub allowed_channels: Vec<Channel>,
    #[serde(default)]
    pub selections: Vec<Selection>,
}
fn default_providers() -> Vec<Provider> {
    vec![Provider::Modrinth, Provider::Curseforge]
}
fn default_true() -> bool {
    true
}
fn default_channels() -> Vec<Channel> {
    vec![Channel::Release, Channel::Beta, Channel::Alpha]
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub provider: Provider,
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub project_url: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyKind {
    Required,
    Optional,
    Incompatible,
    Embedded,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub kind: DependencyKind,
    pub project_id: Option<String>,
    pub version_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub provider: Provider,
    pub project_id: String,
    pub version_id: String,
    pub file_id: String,
    pub name: String,
    pub version: String,
    pub filename: String,
    pub url: Option<String>,
    pub sha1: Option<String>,
    pub sha512: Option<String>,
    pub size: u64,
    pub published: String,
    pub channel: Channel,
    pub game_versions: Vec<String>,
    pub loaders: Vec<Loader>,
    pub dependencies: Vec<Dependency>,
    pub project_url: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntryStatus {
    Updated,
    Unchanged,
    NotFound,
    NoCompatibleVersion,
    DownloadUnavailable,
    DependencyConflict,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Replacement,
    Deduplicated,
    AddedDependency,
    Excluded,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub input_id: String,
    pub source_path: String,
    pub source: Option<Candidate>,
    pub candidates: Vec<Candidate>,
    pub selected: Option<Candidate>,
    pub status: EntryStatus,
    pub reason: Option<String>,
    pub action: Option<Action>,
    pub required_by: Vec<String>,
    pub output_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resolution {
    pub schema_version: u32,
    pub target: Target,
    pub entries: Vec<Entry>,
    pub warnings: Vec<String>,
    pub include_dependencies: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportStatus {
    Completed,
    Partial,
    Empty,
    Failed,
    Cancelled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationReport {
    pub schema_version: u32,
    pub target: Target,
    pub status: ReportStatus,
    pub entries: Vec<Entry>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: String,
    pub completed: u64,
    pub total: u64,
    pub message: String,
}

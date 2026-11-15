use crate::{
    Action, Analysis, ArtifactStore, Candidate, Channel, Dependency, DependencyKind, Entry,
    EntryStatus, Error, HttpRequest, HttpTransport, Limits, Loader, MigrationReport, Progress,
    Project, Provider, ReportStatus, Resolution, ResolveRequest, Target,
};
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::{Digest, Sha512};
use std::collections::{HashMap, HashSet};
use std::io::{Seek, Write};
use url::Url;
use zip::{write::SimpleFileOptions, ZipWriter};

const MR: &str = "https://api.modrinth.com/v2";
const CF: &str = "https://api.curseforge.com/v1";
const API_LIMIT: usize = 8 * 1024 * 1024;

type Callback<'a> = &'a mut dyn FnMut(Progress) -> Result<(), Error>;

/// Platform-independent migration engine. Downloads are intentionally sequential.
pub struct Engine<T> {
    transport: T,
    cf_key: Option<String>,
    limits: Limits,
}

impl<T: HttpTransport> Engine<T> {
    pub fn new(transport: T, cf_key: Option<String>, limits: Limits) -> Self {
        Self {
            transport,
            cf_key,
            limits,
        }
    }

    async fn request(
        &self,
        method: &str,
        url: String,
        body: Vec<u8>,
        max_bytes: usize,
    ) -> Result<Vec<u8>, Error> {
        let parsed =
            Url::parse(&url).map_err(|_| Error::Protocol("Invalid provider URL".into()))?;
        if parsed.scheme() != "https"
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.port().is_some()
        {
            return Err(Error::Protocol("Unsafe provider URL".into()));
        }
        let host = parsed.host_str().unwrap_or("");
        let trusted = host == "api.modrinth.com"
            || host == "cdn.modrinth.com"
            || host == "api.curseforge.com"
            || host == "edge.forgecdn.net"
            || host == "mediafilez.forgecdn.net"
            || host == "media.forgecdn.net";
        if !trusted {
            return Err(Error::Protocol("Untrusted provider URL".into()));
        }
        let mut headers = vec![("User-Agent".into(), "modpacks-migrator/0.1".into())];
        if !body.is_empty() {
            headers.push(("Content-Type".into(), "application/json".into()));
        }
        if host == "api.curseforge.com" || host == "edge.forgecdn.net" {
            let key = self
                .cf_key
                .as_ref()
                .ok_or_else(|| Error::Protocol("CurseForge API key unavailable".into()))?;
            headers.push(("x-api-key".into(), key.clone()));
        }
        for attempt in 0..3 {
            let response = self
                .transport
                .request(HttpRequest {
                    method: method.into(),
                    url: url.clone(),
                    headers: headers.clone(),
                    body: body.clone(),
                    max_bytes,
                })
                .await?;
            if response.body.len() > max_bytes {
                return Err(Error::Limit("HTTP response bytes".into()));
            }
            if (200..300).contains(&response.status) {
                return Ok(response.body);
            }
            if attempt < 2 && (response.status == 429 || response.status >= 500) {
                continue;
            }
            return Err(Error::Protocol(format!(
                "Provider returned HTTP {}",
                response.status
            )));
        }
        unreachable!()
    }
    async fn get_json(&self, url: String) -> Result<Value, Error> {
        let bytes = self.request("GET", url, vec![], API_LIMIT).await?;
        serde_json::from_slice(&bytes)
            .map_err(|e| Error::Protocol(format!("Invalid provider JSON: {e}")))
    }
    async fn post_json(&self, url: String, data: Value) -> Result<Value, Error> {
        let bytes = self
            .request(
                "POST",
                url,
                serde_json::to_vec(&data).map_err(|e| Error::Protocol(e.to_string()))?,
                API_LIMIT,
            )
            .await?;
        serde_json::from_slice(&bytes)
            .map_err(|e| Error::Protocol(format!("Invalid provider JSON: {e}")))
    }
    pub async fn search_projects(
        &self,
        provider: Provider,
        query: &str,
    ) -> Result<Vec<Project>, Error> {
        let mut url = Url::parse(match provider {
            Provider::Modrinth => "https://api.modrinth.com/v2/search",
            Provider::Curseforge => "https://api.curseforge.com/v1/mods/search",
        })
        .unwrap();
        {
            let mut p = url.query_pairs_mut();
            match provider {
                Provider::Modrinth => {
                    p.append_pair("query", query)
                        .append_pair("facets", "[[\"project_type:mod\"]]");
                }
                Provider::Curseforge => {
                    p.append_pair("gameId", "432")
                        .append_pair("classId", "6")
                        .append_pair("searchFilter", query);
                }
            }
        }
        let v = self.get_json(url.into()).await?;
        let rows = array(
            &v,
            match provider {
                Provider::Modrinth => "hits",
                Provider::Curseforge => "data",
            },
        );
        Ok(rows
            .iter()
            .filter_map(|v| {
                let id = id(
                    v,
                    match provider {
                        Provider::Modrinth => "project_id",
                        Provider::Curseforge => "id",
                    },
                )?;
                let name = text(
                    v,
                    match provider {
                        Provider::Modrinth => "title",
                        Provider::Curseforge => "name",
                    },
                );
                let link = match provider {
                    Provider::Modrinth => format!("https://modrinth.com/mod/{id}"),
                    Provider::Curseforge => text(&v["links"], "websiteUrl"),
                };
                Some(Project {
                    provider,
                    project_id: id,
                    name,
                    description: text(
                        v,
                        match provider {
                            Provider::Modrinth => "description",
                            Provider::Curseforge => "summary",
                        },
                    ),
                    project_url: link,
                })
            })
            .collect())
    }
    pub async fn list_candidates(
        &self,
        provider: Provider,
        project_id: &str,
        target: &Target,
    ) -> Result<Vec<Candidate>, Error> {
        self.list_with_warning(provider, project_id, target)
            .await
            .map(|x| x.0)
    }
    async fn list_with_warning(
        &self,
        provider: Provider,
        project_id: &str,
        target: &Target,
    ) -> Result<(Vec<Candidate>, bool), Error> {
        if !valid_id(project_id) {
            return Err(Error::Protocol("Invalid project ID".into()));
        }
        let mut result = Vec::new();
        let mut incomplete = false;
        match provider {
            Provider::Modrinth => {
                let mut url = Url::parse(&format!("{MR}/project/{project_id}/version")).unwrap();
                url.query_pairs_mut()
                    .append_pair(
                        "game_versions",
                        &json!([target.minecraft_version]).to_string(),
                    )
                    .append_pair("loaders", &json!([loader_name(target.loader)]).to_string());
                let v = self.get_json(url.into()).await?;
                let rows = v
                    .as_array()
                    .ok_or_else(|| Error::Protocol("Invalid Modrinth version list".into()))?;
                result.extend(rows.iter().filter_map(mr_candidate));
            }
            Provider::Curseforge => {
                let loader = match target.loader {
                    Loader::Forge => "1",
                    Loader::Fabric => "4",
                    Loader::Quilt => "5",
                    Loader::Neoforge => "6",
                };
                for page in 0..20 {
                    let mut url = Url::parse(&format!("{CF}/mods/{project_id}/files")).unwrap();
                    url.query_pairs_mut()
                        .append_pair("gameVersion", &target.minecraft_version)
                        .append_pair("modLoaderType", loader)
                        .append_pair("pageSize", "50")
                        .append_pair("index", &(page * 50).to_string());
                    let v = self.get_json(url.into()).await?;
                    let rows = array(&v, "data");
                    result.extend(rows.iter().filter_map(|x| cf_candidate(x, target)));
                    let total = v["pagination"]["totalCount"]
                        .as_u64()
                        .unwrap_or((page * 50 + rows.len()) as u64);
                    if rows.is_empty() || (page * 50 + rows.len()) as u64 >= total {
                        break;
                    }
                    if page == 19 {
                        incomplete = true;
                    }
                }
            }
        }
        result.retain(|c| compatible(c, target));
        sort_candidates(&mut result);
        Ok((result, incomplete))
    }
    pub async fn resolve(
        &self,
        analysis: &Analysis,
        request: &ResolveRequest,
        progress: Callback<'_>,
    ) -> Result<Resolution, Error> {
        let mut resolution = Resolution {
            schema_version: 1,
            target: request.target.clone(),
            entries: Vec::new(),
            warnings: Vec::new(),
            include_dependencies: request.include_dependencies,
        };
        let mut hashes = serde_json::Map::new();
        let mut identification_failed = false;
        if request.providers.contains(&Provider::Modrinth) && !analysis.inputs.is_empty() {
            let response = self.post_json(format!("{MR}/version_files"), json!({"hashes": analysis.inputs.iter().map(|i| &i.sha512).collect::<Vec<_>>(), "algorithm":"sha512"})).await;
            match response {
                Ok(Value::Object(v)) => hashes = v,
                Ok(_) => {
                    identification_failed = true;
                    resolution
                        .warnings
                        .push("Modrinth returned invalid hash identification data".into());
                }
                Err(Error::Cancelled) => return Err(Error::Cancelled),
                Err(e) => {
                    identification_failed = true;
                    resolution
                        .warnings
                        .push(format!("Modrinth identification unavailable: {e}"));
                }
            }
        }
        let mut fingerprints = Value::Null;
        if request.providers.contains(&Provider::Curseforge) && !analysis.inputs.is_empty() {
            match self.post_json(format!("{CF}/fingerprints/432"), json!({"fingerprints": analysis.inputs.iter().map(|i| i.fingerprint).collect::<Vec<_>>() })).await { Ok(v) => fingerprints = v, Err(Error::Cancelled) => return Err(Error::Cancelled), Err(e) => { identification_failed = true; resolution.warnings.push(format!("CurseForge identification unavailable: {e}")); } }
        }
        for (index, input) in analysis.inputs.iter().enumerate() {
            progress(event("resolve", index, analysis.inputs.len(), &input.path))?;
            let selection = request.selections.iter().find(|s| s.input_id == input.id);
            let mut entry = Entry {
                input_id: input.id.clone(),
                source_path: input.path.clone(),
                source: None,
                candidates: vec![],
                selected: None,
                status: EntryStatus::NotFound,
                reason: None,
                action: None,
                required_by: vec![],
                output_path: None,
            };
            if selection.is_some_and(|s| s.exclude) {
                entry.action = Some(Action::Excluded);
                entry.reason = Some("Excluded by user".into());
                resolution.entries.push(entry);
                continue;
            }
            let manual = selection.and_then(|s| s.project_id.as_ref().zip(s.provider));
            let mut sources = Vec::new();
            if let Some((project, provider)) = manual {
                sources.push((provider, project.clone(), None));
                entry.action = Some(Action::Replacement);
            } else {
                if let Some(v) = hashes.get(&input.sha512) {
                    if let Some(source) = mr_candidate(v) {
                        sources.push((Provider::Modrinth, source.project_id.clone(), Some(source)));
                    }
                }
                for m in array(&fingerprints["data"], "exactMatches") {
                    let f = &m["file"];
                    if f["fileFingerprint"].as_u64() != Some(input.fingerprint as u64)
                        || !array(f, "hashes").iter().any(|h| {
                            h["algo"].as_u64() == Some(1)
                                && text(h, "value").eq_ignore_ascii_case(&input.sha1)
                        })
                    {
                        continue;
                    }
                    if let Some(project) = id(m, "id").or_else(|| id(f, "modId")) {
                        sources.push((
                            Provider::Curseforge,
                            project,
                            cf_candidate(f, &request.target),
                        ));
                    }
                }
            }
            for (provider, project, source) in sources {
                if entry.source.is_none() {
                    entry.source = source;
                }
                match self
                    .list_with_warning(provider, &project, &request.target)
                    .await
                {
                    Ok((mut candidates, incomplete)) => {
                        if incomplete {
                            resolution.warnings.push(format!(
                                "CurseForge candidate listing incomplete for project {project}"
                            ));
                        }
                        candidates.retain(|c| request.allowed_channels.contains(&c.channel));
                        let chosen =
                            if let Some(version) = selection.and_then(|s| s.version_id.as_ref()) {
                                candidates
                                    .iter()
                                    .find(|c| &c.version_id == version && c.url.is_some())
                            } else {
                                candidates.iter().find(|c| c.url.is_some())
                            };
                        entry.selected = chosen.cloned();
                        entry.candidates.extend(candidates);
                        if entry.selected.is_some() {
                            break;
                        }
                        entry.status = if entry.candidates.is_empty() {
                            EntryStatus::NoCompatibleVersion
                        } else {
                            EntryStatus::DownloadUnavailable
                        };
                    }
                    Err(Error::Cancelled) => return Err(Error::Cancelled),
                    Err(e) => {
                        entry.status = EntryStatus::Error;
                        entry.reason = Some(format!("Provider lookup failed: {e}"));
                    }
                }
            }
            if let Some(c) = &entry.selected {
                entry.status = if c
                    .sha512
                    .as_deref()
                    .is_some_and(|h| h.eq_ignore_ascii_case(&input.sha512))
                    || c.sha1
                        .as_deref()
                        .is_some_and(|h| h.eq_ignore_ascii_case(&input.sha1))
                {
                    EntryStatus::Unchanged
                } else {
                    EntryStatus::Updated
                };
            } else if entry.status == EntryStatus::NotFound && identification_failed {
                entry.status = EntryStatus::Error;
                entry.reason =
                    Some("Identification incomplete because a provider was unavailable".into());
            }
            resolution.entries.push(entry);
        }
        mark_project_conflicts(&mut resolution.entries);
        self.dependencies(&mut resolution, request, progress)
            .await?;
        progress(event(
            "resolve",
            analysis.inputs.len(),
            analysis.inputs.len(),
            "Resolution complete",
        ))?;
        Ok(resolution)
    }
    async fn dependencies(
        &self,
        resolution: &mut Resolution,
        request: &ResolveRequest,
        progress: Callback<'_>,
    ) -> Result<(), Error> {
        let mut index = 0;
        let mut visited = HashSet::new();
        while index < resolution.entries.len() {
            progress(event(
                "dependencies",
                index,
                resolution.entries.len(),
                "Resolving dependencies",
            ))?;
            if !usable(&resolution.entries[index]) {
                index += 1;
                continue;
            }
            let Some(mut candidate) = resolution.entries[index].selected.clone() else {
                index += 1;
                continue;
            };
            if candidate.provider == Provider::Modrinth {
                for dependency in &mut candidate.dependencies {
                    if dependency.project_id.is_none() {
                        if let Some(version) =
                            dependency.version_id.as_deref().filter(|v| valid_id(v))
                        {
                            match self.get_json(format!("{MR}/version/{version}")).await {
                                Ok(v) => dependency.project_id = id(&v, "project_id"),
                                Err(e) => resolution
                                    .warnings
                                    .push(format!("Dependency version lookup failed: {e}")),
                            }
                        }
                    }
                }
                resolution.entries[index].selected = Some(candidate.clone());
            }
            let key = (
                candidate.provider,
                candidate.project_id.clone(),
                candidate.version_id.clone(),
            );
            if !visited.insert(key) {
                index += 1;
                continue;
            }
            for dep in candidate
                .dependencies
                .iter()
                .filter(|d| d.kind == DependencyKind::Required)
            {
                let project = match &dep.project_id {
                    Some(p) => p.clone(),
                    None => {
                        resolution.entries[index].reason =
                            Some("Required dependency has no project ID".into());
                        resolution.entries[index].status = EntryStatus::DependencyConflict;
                        continue;
                    }
                };
                if let Some(existing) = resolution.entries.iter_mut().find(|e| {
                    e.selected.as_ref().is_some_and(|c| {
                        c.provider == candidate.provider && c.project_id == project
                    })
                }) {
                    if !existing.required_by.contains(&candidate.project_id) {
                        existing.required_by.push(candidate.project_id.clone());
                    }
                    if dep.version_id.as_ref().is_some_and(|v| {
                        existing
                            .selected
                            .as_ref()
                            .is_some_and(|c| &c.version_id != v)
                    }) {
                        existing.status = EntryStatus::DependencyConflict;
                        existing.reason = Some("Conflicting exact dependency version".into());
                        resolution.entries[index].status = EntryStatus::DependencyConflict;
                        resolution.entries[index].reason =
                            Some("Conflicting exact dependency version".into());
                    }
                    continue;
                }
                if !request.include_dependencies {
                    resolution.entries[index].status = EntryStatus::DependencyConflict;
                    resolution.entries[index].reason =
                        Some(format!("Required dependency {project} is missing"));
                    continue;
                }
                let dependency_id = format!("dependency-{:?}-{project}", candidate.provider);
                if resolution
                    .entries
                    .iter()
                    .any(|e| e.input_id == dependency_id)
                {
                    resolution.entries[index].status = EntryStatus::DependencyConflict;
                    resolution.entries[index].reason =
                        Some(format!("Required dependency {project} is unavailable"));
                    continue;
                }
                let selection = request
                    .selections
                    .iter()
                    .find(|s| s.input_id == dependency_id);
                if selection.is_some_and(|s| s.exclude) {
                    resolution.entries[index].status = EntryStatus::DependencyConflict;
                    resolution.entries[index].reason =
                        Some(format!("Required dependency {project} was excluded"));
                    resolution.entries.push(Entry {
                        input_id: dependency_id,
                        source_path: String::new(),
                        source: None,
                        candidates: vec![],
                        selected: None,
                        status: EntryStatus::DependencyConflict,
                        reason: Some("Excluded by user".into()),
                        action: Some(Action::Excluded),
                        required_by: vec![candidate.project_id.clone()],
                        output_path: None,
                    });
                    continue;
                }
                let (selected_provider, selected_project) = selection
                    .and_then(|s| s.provider.zip(s.project_id.as_deref()))
                    .unwrap_or((candidate.provider, project.as_str()));
                let replaced =
                    selected_provider != candidate.provider || selected_project != project;
                let list = self
                    .list_with_warning(selected_provider, selected_project, &request.target)
                    .await;
                let mut candidates = match list {
                    Ok((c, incomplete)) => {
                        if incomplete {
                            resolution.warnings.push(format!(
                                "Candidate listing incomplete for dependency {project}"
                            ));
                        }
                        c
                    }
                    Err(e) => {
                        resolution.entries[index].status = EntryStatus::DependencyConflict;
                        resolution.entries[index].reason =
                            Some(format!("Required dependency {project} unavailable: {e}"));
                        continue;
                    }
                };
                candidates.retain(|c| request.allowed_channels.contains(&c.channel));
                let selected = candidates
                    .iter()
                    .find(|c| {
                        c.url.is_some()
                            && selection
                                .and_then(|s| s.version_id.as_ref())
                                .is_none_or(|v| v == &c.version_id)
                            && (replaced
                                || dep.version_id.as_ref().is_none_or(|v| v == &c.version_id))
                    })
                    .cloned();
                if selected.is_none() {
                    resolution.entries[index].status = EntryStatus::DependencyConflict;
                    resolution.entries[index].reason = Some(format!(
                        "Required dependency {project} has no compatible version"
                    ));
                    continue;
                }
                if replaced {
                    resolution.entries[index].status = EntryStatus::DependencyConflict;
                    resolution.entries[index].reason = Some(format!(
                        "Replacement does not satisfy required dependency {project}"
                    ));
                }
                resolution.entries.push(Entry {
                    input_id: dependency_id,
                    source_path: String::new(),
                    source: None,
                    candidates,
                    selected,
                    status: EntryStatus::Updated,
                    reason: None,
                    action: Some(if replaced {
                        Action::Replacement
                    } else {
                        Action::AddedDependency
                    }),
                    required_by: vec![candidate.project_id.clone()],
                    output_path: None,
                });
            }
            index += 1;
        }
        mark_conflicts_and_prune(&mut resolution.entries);
        Ok(())
    }
    pub async fn convert<W: Write + Seek>(
        &self,
        resolution: &Resolution,
        store: &mut dyn ArtifactStore,
        writer: W,
        progress: Callback<'_>,
    ) -> Result<MigrationReport, Error> {
        let mut entries = resolution.entries.clone();
        let mut staged = HashMap::<String, String>::new();
        let mut total = 0u64;
        for i in 0..entries.len() {
            progress(event("download", i, entries.len(), &entries[i].source_path))?;
            if !usable(&entries[i]) {
                continue;
            }
            let c = entries[i].selected.clone().unwrap();
            let key = artifact_key(&c);
            if staged.contains_key(&key) {
                entries[i].action = Some(Action::Deduplicated);
                continue;
            }
            let outcome =
                async {
                    let url = c
                        .url
                        .as_ref()
                        .ok_or_else(|| Error::Protocol("Download URL unavailable".into()))?;
                    if c.sha1.is_none() && c.sha512.is_none() {
                        return Err(Error::Protocol("No cryptographic download hash".into()));
                    }
                    if c.size > self.limits.max_entry_bytes {
                        return Err(Error::Limit("download bytes".into()));
                    }
                    let bytes = self
                        .request(
                            "GET",
                            url.clone(),
                            vec![],
                            self.limits.max_entry_bytes as usize,
                        )
                        .await?;
                    if bytes.len() as u64 != c.size {
                        return Err(Error::Protocol("Download size mismatch".into()));
                    }
                    if c.sha1.as_ref().is_some_and(|h| {
                        !format!("{:x}", Sha1::digest(&bytes)).eq_ignore_ascii_case(h)
                    }) || c.sha512.as_ref().is_some_and(|h| {
                        !format!("{:x}", Sha512::digest(&bytes)).eq_ignore_ascii_case(h)
                    }) {
                        return Err(Error::Protocol("Download hash mismatch".into()));
                    }
                    let content_key = format!("{:x}", Sha512::digest(&bytes));
                    if !staged.values().any(|value| value == &content_key) {
                        total = total
                            .checked_add(bytes.len() as u64)
                            .ok_or(Error::Limit("staging bytes".into()))?;
                        if total > self.limits.max_total_bytes {
                            return Err(Error::Limit("staging bytes".into()));
                        }
                        store.put(&content_key, &bytes)?;
                    }
                    Ok::<String, Error>(content_key)
                }
                .await;
            match outcome {
                Ok(content_key) => {
                    staged.insert(key, content_key);
                }
                Err(Error::Cancelled) => return Err(Error::Cancelled),
                Err(e) => {
                    entries[i].status = EntryStatus::Error;
                    entries[i].reason = Some(format!("Download failed: {e}"));
                }
            }
        }
        mark_conflicts_and_prune(&mut entries);
        let mut zip = ZipWriter::new(writer);
        let mut names = HashSet::new();
        let mut paths: HashMap<String, String> = HashMap::new();
        for i in 0..entries.len() {
            progress(event("package", i, entries.len(), &entries[i].source_path))?;
            if !usable(&entries[i]) {
                continue;
            }
            let c = entries[i].selected.as_ref().unwrap();
            let artifact = artifact_key(c);
            let Some(key) = staged.get(&artifact) else {
                entries[i].status = EntryStatus::Error;
                entries[i].reason = Some("Verified artifact unavailable".into());
                continue;
            };
            if let Some(path) = paths.get(key) {
                entries[i].output_path = Some(path.clone());
                entries[i].action = Some(Action::Deduplicated);
                continue;
            }
            let filename = safe_filename(&c.filename);
            let mut path = format!("mods/{filename}");
            let mut suffix = 2;
            while !names.insert(path.to_ascii_lowercase()) {
                path = format!(
                    "mods/{}-{suffix}.jar",
                    filename.strip_suffix(".jar").unwrap_or(&filename)
                );
                suffix += 1;
            }
            zip.start_file(&path, SimpleFileOptions::default())?;
            std::io::copy(&mut store.open(key)?, &mut zip)?;
            entries[i].output_path = Some(path.clone());
            paths.insert(key.clone(), path);
        }
        let count = entries.iter().filter(|e| e.output_path.is_some()).count();
        let failed = entries
            .iter()
            .any(|e| e.action != Some(Action::Excluded) && e.output_path.is_none());
        let report = MigrationReport {
            schema_version: 1,
            target: resolution.target.clone(),
            status: if count == 0 {
                ReportStatus::Empty
            } else if failed {
                ReportStatus::Partial
            } else {
                ReportStatus::Completed
            },
            entries,
            warnings: resolution.warnings.clone(),
        };
        zip.start_file("migration-report.json", SimpleFileOptions::default())?;
        serde_json::to_writer(&mut zip, &report).map_err(|e| Error::Protocol(e.to_string()))?;
        zip.finish()?;
        progress(event("package", count, count, "Migration complete"))?;
        Ok(report)
    }
}

fn event(stage: &str, completed: usize, total: usize, message: &str) -> Progress {
    Progress {
        stage: stage.into(),
        completed: completed as u64,
        total: total as u64,
        message: message.into(),
    }
}
fn array<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}
fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}
fn id(v: &Value, key: &str) -> Option<String> {
    let v = v.get(key)?;
    v.as_str()
        .map(str::to_owned)
        .or_else(|| v.as_u64().map(|n| n.to_string()))
}
fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn loader_name(l: Loader) -> &'static str {
    match l {
        Loader::Fabric => "fabric",
        Loader::Forge => "forge",
        Loader::Neoforge => "neoforge",
        Loader::Quilt => "quilt",
    }
}
fn parse_loader(s: &str) -> Option<Loader> {
    match s {
        "fabric" => Some(Loader::Fabric),
        "forge" => Some(Loader::Forge),
        "neoforge" => Some(Loader::Neoforge),
        "quilt" => Some(Loader::Quilt),
        _ => None,
    }
}
fn compatible(c: &Candidate, t: &Target) -> bool {
    c.game_versions.contains(&t.minecraft_version)
        && c.loaders.contains(&t.loader)
        && c.filename.to_ascii_lowercase().ends_with(".jar")
}
fn sort_candidates(c: &mut [Candidate]) {
    c.sort_by(|a, b| {
        b.published
            .cmp(&a.published)
            .then_with(|| a.project_id.cmp(&b.project_id))
            .then_with(|| a.version_id.cmp(&b.version_id))
            .then_with(|| a.file_id.cmp(&b.file_id))
    });
}
fn mr_candidate(v: &Value) -> Option<Candidate> {
    let project = id(v, "project_id")?;
    let version = id(v, "id")?;
    let files = array(v, "files");
    let f = files.iter().find(|f| {
        f["primary"].as_bool() == Some(true)
            && text(f, "filename").to_ascii_lowercase().ends_with(".jar")
    })?;
    let dependencies = array(v, "dependencies")
        .iter()
        .filter_map(|d| {
            Some(Dependency {
                kind: match text(d, "dependency_type").as_str() {
                    "required" => DependencyKind::Required,
                    "optional" => DependencyKind::Optional,
                    "incompatible" => DependencyKind::Incompatible,
                    "embedded" => DependencyKind::Embedded,
                    _ => return None,
                },
                project_id: id(d, "project_id"),
                version_id: id(d, "version_id"),
            })
        })
        .collect();
    Some(Candidate {
        provider: Provider::Modrinth,
        project_id: project.clone(),
        version_id: version.clone(),
        file_id: text(f, "filename"),
        name: text(v, "name"),
        version: text(v, "version_number"),
        filename: text(f, "filename"),
        url: f["url"].as_str().map(str::to_owned),
        sha1: f["hashes"]["sha1"].as_str().map(str::to_owned),
        sha512: f["hashes"]["sha512"].as_str().map(str::to_owned),
        size: f["size"].as_u64()?,
        published: text(v, "date_published"),
        channel: match text(v, "version_type").as_str() {
            "release" => Channel::Release,
            "beta" => Channel::Beta,
            "alpha" => Channel::Alpha,
            _ => return None,
        },
        game_versions: array(v, "game_versions")
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        loaders: array(v, "loaders")
            .iter()
            .filter_map(Value::as_str)
            .filter_map(parse_loader)
            .collect(),
        dependencies,
        project_url: format!("https://modrinth.com/mod/{project}"),
    })
}
fn cf_candidate(v: &Value, target: &Target) -> Option<Candidate> {
    let project = id(v, "modId")?;
    let file = id(v, "id")?;
    let games: Vec<String> = array(v, "gameVersions")
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    let loader = loader_name(target.loader);
    let loaders = games
        .iter()
        .filter_map(|s| parse_loader(&s.to_ascii_lowercase()))
        .collect();
    let dependencies = array(v, "dependencies")
        .iter()
        .filter_map(|d| {
            Some(Dependency {
                kind: match d["relationType"].as_u64()? {
                    3 => DependencyKind::Required,
                    5 => DependencyKind::Incompatible,
                    2 => DependencyKind::Optional,
                    6 => DependencyKind::Embedded,
                    _ => return None,
                },
                project_id: id(d, "modId"),
                version_id: None,
            })
        })
        .collect();
    let _ = loader;
    Some(Candidate {
        provider: Provider::Curseforge,
        project_id: project.clone(),
        version_id: file.clone(),
        file_id: file,
        name: text(v, "displayName"),
        version: text(v, "displayName"),
        filename: text(v, "fileName"),
        url: v["downloadUrl"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        sha1: array(v, "hashes")
            .iter()
            .find(|h| h["algo"].as_u64() == Some(1))
            .and_then(|h| h["value"].as_str())
            .map(str::to_owned),
        sha512: None,
        size: v["fileLength"].as_u64()?,
        published: text(v, "fileDate"),
        channel: match v["releaseType"].as_u64()? {
            1 => Channel::Release,
            2 => Channel::Beta,
            3 => Channel::Alpha,
            _ => return None,
        },
        game_versions: games,
        loaders,
        dependencies,
        project_url: format!("https://www.curseforge.com/minecraft/mc-mods/{project}"),
    })
}
fn usable(e: &Entry) -> bool {
    e.selected.is_some() && matches!(e.status, EntryStatus::Updated | EntryStatus::Unchanged)
}
fn artifact_key(c: &Candidate) -> String {
    format!(
        "{:x}",
        Sha512::digest(
            format!(
                "{:?}\0{}\0{}\0{}",
                c.provider, c.project_id, c.version_id, c.file_id
            )
            .as_bytes()
        )
    )
}
fn safe_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.to_ascii_lowercase().ends_with(".jar") && s != ".jar" {
        s
    } else {
        "mod.jar".into()
    }
}
fn mark_project_conflicts(entries: &mut [Entry]) {
    let snapshot = entries.to_vec();
    for (i, a) in snapshot.iter().enumerate() {
        let Some(a) = a.selected.as_ref().filter(|_| usable(&snapshot[i])) else {
            continue;
        };
        for (j, b) in snapshot.iter().enumerate().skip(i + 1) {
            let Some(b) = b.selected.as_ref().filter(|_| usable(&snapshot[j])) else {
                continue;
            };
            if a.provider == b.provider
                && a.project_id == b.project_id
                && (a.version_id != b.version_id || a.file_id != b.file_id)
            {
                for index in [i, j] {
                    entries[index].status = EntryStatus::DependencyConflict;
                    entries[index].reason =
                        Some("Multiple versions selected for the same project".into());
                }
            }
        }
    }
}
fn mark_conflicts_and_prune(entries: &mut [Entry]) {
    mark_project_conflicts(entries);
    let snapshot = entries.to_vec();
    for (i, entry) in snapshot.iter().enumerate() {
        if !usable(entry) {
            continue;
        }
        let c = entry.selected.as_ref().unwrap();
        for d in c
            .dependencies
            .iter()
            .filter(|d| d.kind == DependencyKind::Incompatible)
        {
            if let Some(project) = &d.project_id {
                for (j, other) in snapshot.iter().enumerate() {
                    if usable(other)
                        && other.selected.as_ref().is_some_and(|x| {
                            x.provider == c.provider
                                && &x.project_id == project
                                && d.version_id.as_ref().is_none_or(|v| v == &x.version_id)
                        })
                    {
                        entries[i].status = EntryStatus::DependencyConflict;
                        entries[i].reason = Some(format!("Incompatible with project {project}"));
                        entries[j].status = EntryStatus::DependencyConflict;
                        entries[j].reason =
                            Some(format!("Incompatible with project {}", c.project_id));
                    }
                }
            }
        }
    }
    loop {
        let snapshot = entries.to_vec();
        let mut changed = false;
        for e in entries.iter_mut().filter(|e| usable(e)) {
            let c = e.selected.as_ref().unwrap();
            for d in c
                .dependencies
                .iter()
                .filter(|d| d.kind == DependencyKind::Required)
            {
                let found = d.project_id.as_ref().is_some_and(|p| {
                    snapshot.iter().any(|x| {
                        usable(x)
                            && x.selected.as_ref().is_some_and(|s| {
                                s.provider == c.provider
                                    && &s.project_id == p
                                    && d.version_id.as_ref().is_none_or(|v| v == &s.version_id)
                            })
                    })
                });
                if !found {
                    e.status = EntryStatus::DependencyConflict;
                    e.reason = Some("Required dependency missing or failed".into());
                    changed = true;
                    break;
                }
            }
        }
        if !changed {
            break;
        }
    }
}

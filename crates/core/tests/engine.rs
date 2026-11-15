use async_trait::async_trait;
use modpacks_migrator_core::*;
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use sha2::Sha512;
use std::{
    collections::HashMap,
    future::Future,
    io::{Cursor, Read},
    pin::pin,
    task::{Context, Poll, Waker},
};

fn run<F: Future>(f: F) -> F::Output {
    let mut f = pin!(f);
    let mut cx = Context::from_waker(Waker::noop());
    match f.as_mut().poll(&mut cx) {
        Poll::Ready(v) => v,
        Poll::Pending => panic!("mock unexpectedly pending"),
    }
}
struct Mock;
#[async_trait(?Send)]
impl HttpTransport for Mock {
    async fn request(&self, r: HttpRequest) -> Result<HttpResponse, Error> {
        let body = if r.url.ends_with("/version_files") {
            json!({"hash": version("old", "2020", "release", vec![])})
        } else if r.url.contains("/project/p/version") {
            json!([
                version("stable", "2024", "release", vec![]),
                version("alpha", "2025", "alpha", vec![])
            ])
        } else if r.url == "https://cdn.modrinth.com/alpha.jar" {
            return Ok(HttpResponse {
                status: 200,
                headers: vec![],
                body: b"alpha".to_vec(),
            });
        } else {
            return Err(Error::Network(format!("Unexpected URL {}", r.url)));
        };
        Ok(HttpResponse {
            status: 200,
            headers: vec![],
            body: serde_json::to_vec(&body).unwrap(),
        })
    }
}
fn version(id: &str, date: &str, channel: &str, deps: Vec<Value>) -> Value {
    let data = id.as_bytes();
    json!({"id":id,"project_id":"p","name":id,"version_number":id,"date_published":date,"version_type":channel,"game_versions":["1.20.1"],"loaders":["fabric"],"dependencies":deps,"files":[{"primary":true,"filename":format!("{id}.jar"),"url":format!("https://cdn.modrinth.com/{id}.jar"),"size":data.len(),"hashes":{"sha1":format!("{:x}",Sha1::digest(data)),"sha512":format!("{:x}",Sha512::digest(data))}}]})
}
#[derive(Default)]
struct Store(HashMap<String, Vec<u8>>);
impl ArtifactStore for Store {
    fn put(&mut self, key: &str, data: &[u8]) -> Result<(), Error> {
        self.0.insert(key.into(), data.into());
        Ok(())
    }
    fn open(&self, key: &str) -> Result<Box<dyn Read + '_>, Error> {
        Ok(Box::new(Cursor::new(self.0.get(key).unwrap())))
    }
}
fn target() -> Target {
    Target {
        minecraft_version: "1.20.1".into(),
        loader: Loader::Fabric,
    }
}
fn req() -> ResolveRequest {
    ResolveRequest {
        target: target(),
        providers: vec![Provider::Modrinth],
        include_dependencies: true,
        allowed_channels: vec![Channel::Release, Channel::Beta, Channel::Alpha],
        selections: vec![],
    }
}
#[test]
fn newest_alpha_and_verified_zip() {
    let engine = Engine::new(Mock, None, Limits::default());
    let analysis = Analysis {
        inputs: vec![Input {
            id: "1".into(),
            path: "mods/old.jar".into(),
            size: 3,
            sha1: "x".into(),
            sha512: "hash".into(),
            fingerprint: 1,
        }],
        ignored_files: 0,
    };
    let resolution = run(engine.resolve(&analysis, &req(), &mut |_| Ok(()))).unwrap();
    assert_eq!(
        resolution.entries[0].selected.as_ref().unwrap().version_id,
        "alpha"
    );
    let mut output = Cursor::new(Vec::new());
    let report = run(
        engine.convert(&resolution, &mut Store::default(), &mut output, &mut |_| {
            Ok(())
        }),
    )
    .unwrap();
    assert_eq!(report.status, ReportStatus::Completed);
    let mut zip = zip::ZipArchive::new(Cursor::new(output.into_inner())).unwrap();
    assert_eq!(zip.len(), 2);
    let mut data = String::new();
    zip.by_name("mods/alpha.jar")
        .unwrap()
        .read_to_string(&mut data)
        .unwrap();
    assert_eq!(data, "alpha");
    let mut data = String::new();
    zip.by_name("migration-report.json")
        .unwrap()
        .read_to_string(&mut data)
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&data).unwrap()["status"],
        "completed"
    );
}
#[test]
fn wrong_hash_produces_empty_report() {
    let engine = Engine::new(Mock, None, Limits::default());
    let mut candidate: Candidate = serde_json::from_value(json!({"provider":"modrinth","projectId":"p","versionId":"alpha","fileId":"alpha.jar","name":"alpha","version":"alpha","filename":"alpha.jar","url":"https://cdn.modrinth.com/alpha.jar","sha1":"bad","sha512":null,"size":5,"published":"2025","channel":"alpha","gameVersions":["1.20.1"],"loaders":["fabric"],"dependencies":[],"projectUrl":"https://modrinth.com/mod/p"})).unwrap();
    candidate.sha1 = Some("bad".into());
    let entry = Entry {
        input_id: "1".into(),
        source_path: "a.jar".into(),
        source: None,
        candidates: vec![],
        selected: Some(candidate),
        status: EntryStatus::Updated,
        reason: None,
        action: None,
        required_by: vec![],
        output_path: None,
    };
    let mut parent = entry.clone();
    parent.input_id = "parent".into();
    let parent_candidate = parent.selected.as_mut().unwrap();
    parent_candidate.project_id = "parent".into();
    parent_candidate.sha1 = Some(format!("{:x}", Sha1::digest(b"alpha")));
    parent_candidate.dependencies = vec![Dependency {
        kind: DependencyKind::Required,
        project_id: Some("p".into()),
        version_id: Some("alpha".into()),
    }];
    let resolution = Resolution {
        schema_version: 1,
        target: target(),
        entries: vec![entry, parent],
        warnings: vec![],
        include_dependencies: true,
    };
    let mut out = Cursor::new(Vec::new());
    let report = run(engine.convert(
        &resolution,
        &mut Store::default(),
        &mut out,
        &mut |_| Ok(()),
    ))
    .unwrap();
    assert_eq!(report.status, ReportStatus::Empty);
    assert_eq!(report.entries[1].status, EntryStatus::DependencyConflict);
    assert!(report.entries[0]
        .reason
        .as_ref()
        .unwrap()
        .contains("hash mismatch"));
    assert_eq!(
        zip::ZipArchive::new(Cursor::new(out.into_inner()))
            .unwrap()
            .len(),
        1
    );
}

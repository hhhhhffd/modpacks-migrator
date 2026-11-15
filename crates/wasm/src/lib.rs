use async_trait::async_trait;
use js_sys::{Function, Promise, Reflect, Uint8Array};
use modpacks_migrator_core::{
    analyze_archive, Analysis, ArtifactStore, Engine, Error, HttpRequest, HttpResponse,
    HttpTransport, Limits, Provider, Resolution, ResolveRequest, Target,
};
use std::io::{self, Read, Seek, SeekFrom, Write};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

include!(concat!(env!("OUT_DIR"), "/credentials.rs"));

fn call(adapter: &JsValue, method: &str, args: &[JsValue]) -> Result<JsValue, JsValue> {
    let function: Function = Reflect::get(adapter, &method.into())?.dyn_into()?;
    function.apply(adapter, &args.iter().cloned().collect())
}
fn js_error(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}
fn io_error(e: JsValue) -> io::Error {
    io::Error::other(e.as_string().unwrap_or_else(|| format!("{e:?}")))
}
fn json<T: serde::Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(js_error)
}
fn parse<T: serde::de::DeserializeOwned>(value: JsValue) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value).map_err(js_error)
}

struct InputReader {
    adapter: JsValue,
    position: u64,
    size: u64,
    cache_start: u64,
    cache: Vec<u8>,
}
impl Read for InputReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        if out.is_empty() || self.position >= self.size {
            return Ok(0);
        }
        if self.position < self.cache_start
            || self.position >= self.cache_start + self.cache.len() as u64
        {
            self.cache_start = self.position;
            let n = (self.size - self.position).min(1024 * 1024);
            let result = call(
                &self.adapter,
                "readInput",
                &[(self.position as f64).into(), (n as f64).into()],
            )
            .map_err(io_error)?;
            self.cache = Uint8Array::new(&result).to_vec();
            if self.cache.is_empty() {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "Input could not be read",
                ));
            }
        }
        let offset = (self.position - self.cache_start) as usize;
        let n = out.len().min(self.cache.len() - offset);
        out[..n].copy_from_slice(&self.cache[offset..offset + n]);
        self.position += n as u64;
        Ok(n)
    }
}
fn seek(position: &mut u64, size: u64, from: SeekFrom) -> io::Result<u64> {
    let next = match from {
        SeekFrom::Start(n) => n as i128,
        SeekFrom::End(n) => size as i128 + n as i128,
        SeekFrom::Current(n) => *position as i128 + n as i128,
    };
    if next < 0 || next > u64::MAX as i128 {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "Invalid seek"));
    }
    *position = next as u64;
    Ok(*position)
}
impl Seek for InputReader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        seek(&mut self.position, self.size, from)
    }
}
struct Output {
    adapter: JsValue,
    position: u64,
    size: u64,
}
impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let data = Uint8Array::from(bytes);
        call(
            &self.adapter,
            "writeOutput",
            &[(self.position as f64).into(), data.into()],
        )
        .map_err(io_error)?;
        self.position += bytes.len() as u64;
        self.size = self.size.max(self.position);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
impl Seek for Output {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        seek(&mut self.position, self.size, from)
    }
}
struct Store {
    adapter: JsValue,
}
struct StoredReader {
    adapter: JsValue,
    key: String,
    position: u64,
}
impl Read for StoredReader {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let value = call(
            &self.adapter,
            "readArtifact",
            &[
                self.key.clone().into(),
                (self.position as f64).into(),
                (out.len() as f64).into(),
            ],
        )
        .map_err(io_error)?;
        let bytes = Uint8Array::new(&value);
        let n = bytes.length() as usize;
        bytes.copy_to(&mut out[..n]);
        self.position += n as u64;
        Ok(n)
    }
}
impl ArtifactStore for Store {
    fn put(&mut self, key: &str, data: &[u8]) -> Result<(), Error> {
        call(
            &self.adapter,
            "writeArtifact",
            &[key.into(), Uint8Array::from(data).into()],
        )
        .map_err(|e| Error::Transport(format!("Browser storage: {e:?}")))?;
        Ok(())
    }
    fn open(&self, key: &str) -> Result<Box<dyn Read + '_>, Error> {
        Ok(Box::new(StoredReader {
            adapter: self.adapter.clone(),
            key: key.into(),
            position: 0,
        }))
    }
}
#[derive(Clone)]
struct Transport {
    adapter: JsValue,
}
#[async_trait(?Send)]
impl HttpTransport for Transport {
    async fn request(&self, request: HttpRequest) -> Result<HttpResponse, Error> {
        let headers = js_sys::Array::new();
        for (key, value) in request.headers {
            let pair = js_sys::Array::new();
            pair.push(&key.into());
            pair.push(&value.into());
            headers.push(&pair);
        }
        let response = call(
            &self.adapter,
            "fetch",
            &[
                request.method.into(),
                request.url.into(),
                headers.into(),
                Uint8Array::from(request.body.as_slice()).into(),
                (request.max_bytes as f64).into(),
            ],
        )
        .map_err(|e| Error::Network(format!("{e:?}")))?;
        let result = JsFuture::from(Promise::from(response))
            .await
            .map_err(|e| Error::Network(e.as_string().unwrap_or_else(|| format!("{e:?}"))))?;
        let status = Reflect::get(&result, &"status".into())
            .map_err(|e| Error::Network(format!("{e:?}")))?
            .as_f64()
            .unwrap_or(0.0) as u16;
        let body = Uint8Array::new(
            &Reflect::get(&result, &"body".into()).map_err(|e| Error::Network(format!("{e:?}")))?,
        )
        .to_vec();
        let headers: Vec<(String, String)> = parse(
            Reflect::get(&result, &"headers".into())
                .map_err(|e| Error::Network(format!("{e:?}")))?,
        )
        .map_err(|e| Error::Network(format!("{e:?}")))?;
        Ok(HttpResponse {
            status,
            headers,
            body,
        })
    }
}
#[wasm_bindgen]
pub struct BrowserMigrator {
    adapter: JsValue,
    analysis: Option<Analysis>,
    resolution: Option<Resolution>,
}
#[wasm_bindgen]
impl BrowserMigrator {
    #[wasm_bindgen(constructor)]
    pub fn new(adapter: JsValue) -> Self {
        Self {
            adapter,
            analysis: None,
            resolution: None,
        }
    }
    #[wasm_bindgen(js_name = analyzeZip)]
    pub fn analyze_zip(&mut self, size: f64) -> Result<JsValue, JsValue> {
        let reader = InputReader {
            adapter: self.adapter.clone(),
            position: 0,
            size: size as u64,
            cache_start: 0,
            cache: Vec::new(),
        };
        let analysis = analyze_archive(reader, &Limits::default()).map_err(js_error)?;
        let result = json(&analysis)?;
        self.analysis = Some(analysis);
        self.resolution = None;
        Ok(result)
    }
    #[wasm_bindgen(js_name = resolveMods)]
    pub async fn resolve_mods(&mut self, request: JsValue) -> Result<JsValue, JsValue> {
        let request: ResolveRequest = parse(request)?;
        let analysis = self
            .analysis
            .as_ref()
            .ok_or_else(|| js_error("Analyze an archive first"))?;
        let engine = Engine::new(
            Transport {
                adapter: self.adapter.clone(),
            },
            CURSEFORGE_API_KEY.map(str::to_owned),
            Limits::default(),
        );
        let adapter = self.adapter.clone();
        let resolution = engine
            .resolve(analysis, &request, &mut |progress| {
                let _ = call(
                    &adapter,
                    "progress",
                    &[json(&progress).map_err(|e| Error::Transport(format!("{e:?}")))?],
                );
                Ok(())
            })
            .await
            .map_err(js_error)?;
        let result = json(&resolution)?;
        self.resolution = Some(resolution);
        Ok(result)
    }
    #[wasm_bindgen(js_name = searchProjects)]
    pub async fn search_projects(
        &self,
        provider: JsValue,
        query: String,
    ) -> Result<JsValue, JsValue> {
        let engine = Engine::new(
            Transport {
                adapter: self.adapter.clone(),
            },
            CURSEFORGE_API_KEY.map(str::to_owned),
            Limits::default(),
        );
        json(
            &engine
                .search_projects(parse::<Provider>(provider)?, &query)
                .await
                .map_err(js_error)?,
        )
    }
    #[wasm_bindgen(js_name = listCandidates)]
    pub async fn list_candidates(
        &self,
        provider: JsValue,
        project: String,
        target: JsValue,
    ) -> Result<JsValue, JsValue> {
        let engine = Engine::new(
            Transport {
                adapter: self.adapter.clone(),
            },
            CURSEFORGE_API_KEY.map(str::to_owned),
            Limits::default(),
        );
        json(
            &engine
                .list_candidates(
                    parse::<Provider>(provider)?,
                    &project,
                    &parse::<Target>(target)?,
                )
                .await
                .map_err(js_error)?,
        )
    }
    #[wasm_bindgen(js_name = convertZip)]
    pub async fn convert_zip(&self) -> Result<JsValue, JsValue> {
        let resolution = self
            .resolution
            .as_ref()
            .ok_or_else(|| js_error("Resolve the archive first"))?;
        let engine = Engine::new(
            Transport {
                adapter: self.adapter.clone(),
            },
            CURSEFORGE_API_KEY.map(str::to_owned),
            Limits::default(),
        );
        let mut store = Store {
            adapter: self.adapter.clone(),
        };
        let output = Output {
            adapter: self.adapter.clone(),
            position: 0,
            size: 0,
        };
        let adapter = self.adapter.clone();
        let report = engine
            .convert(resolution, &mut store, output, &mut |progress| {
                let _ = call(
                    &adapter,
                    "progress",
                    &[json(&progress).map_err(|e| Error::Transport(format!("{e:?}")))?],
                );
                Ok(())
            })
            .await
            .map_err(js_error)?;
        json(&report)
    }
}

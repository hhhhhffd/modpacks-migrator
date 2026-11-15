use crate::Error;
use async_trait::async_trait;
use std::io::Read;

#[derive(Clone, Debug)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub max_bytes: usize,
}

#[derive(Clone, Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[async_trait(?Send)]
pub trait HttpTransport {
    async fn request(&self, request: HttpRequest) -> Result<HttpResponse, Error>;
}

pub trait ArtifactStore {
    fn put(&mut self, key: &str, data: &[u8]) -> Result<(), Error>;
    fn open(&self, key: &str) -> Result<Box<dyn Read + '_>, Error>;
}

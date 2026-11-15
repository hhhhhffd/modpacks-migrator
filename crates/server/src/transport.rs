use async_trait::async_trait;
use futures_util::StreamExt;
use modpacks_migrator_core::{Error, HttpRequest, HttpResponse, HttpTransport};
use reqwest::{Client, Url};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use std::time::Duration;

#[derive(Clone)]
pub struct NativeTransport {
    client: Client,
    cancelled: Arc<AtomicBool>,
}

impl NativeTransport {
    pub fn new() -> Result<Self, Error> {
        let client = Client::builder()
            .user_agent(concat!("modpacks-migrator/", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(90))
            .build()
            .map_err(|_| Error::Network("Cannot initialize HTTP client".into()))?;
        Ok(Self {
            client,
            cancelled: Arc::new(AtomicBool::new(false)),
        })
    }

    pub fn with_cancellation(&self, cancelled: Arc<AtomicBool>) -> Self {
        Self {
            client: self.client.clone(),
            cancelled,
        }
    }

    async fn perform(&self, request: HttpRequest) -> Result<HttpResponse, Error> {
        let mut url =
            Url::parse(&request.url).map_err(|_| Error::Network("Invalid provider URL".into()))?;
        let mut method = reqwest::Method::from_bytes(request.method.as_bytes())
            .map_err(|_| Error::Network("Invalid request method".into()))?;
        let mut body = request.body;
        let mut attempt = 0u32;
        let mut redirects = 0u32;
        loop {
            validate_url(&url)?;
            let mut builder = self
                .client
                .request(method.clone(), url.clone())
                .body(body.clone());
            for (name, value) in &request.headers {
                if name.eq_ignore_ascii_case("x-api-key") && !credential_origin(&url) {
                    continue;
                }
                builder = builder.header(name, value);
            }
            let response = builder
                .send()
                .await
                .map_err(|_| Error::Network("Provider request failed or timed out".into()))?;
            if response.status().is_redirection() {
                if redirects >= 5 {
                    return Err(Error::Network("Too many download redirects".into()));
                }
                let location = response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|v| v.to_str().ok())
                    .ok_or_else(|| Error::Network("Redirect has no valid location".into()))?;
                let next = url
                    .join(location)
                    .map_err(|_| Error::Network("Invalid download redirect".into()))?;
                validate_url(&next)?;
                // API POST bodies must never be forwarded to a redirect destination.
                if method != reqwest::Method::GET && method != reqwest::Method::HEAD {
                    return Err(Error::Network(
                        "Provider API redirect is not supported".into(),
                    ));
                }
                url = next;
                method = reqwest::Method::GET;
                body.clear();
                redirects += 1;
                continue;
            }
            if (response.status().as_u16() == 429 || response.status().is_server_error())
                && attempt < 2
            {
                let delay = response
                    .headers()
                    .get(reqwest::header::RETRY_AFTER)
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse::<u64>().ok())
                    .unwrap_or(1 << attempt)
                    .min(30);
                attempt += 1;
                tokio::time::sleep(Duration::from_secs(delay)).await;
                continue;
            }
            let status = response.status().as_u16();
            let headers = response
                .headers()
                .iter()
                .filter_map(|(name, value)| {
                    value
                        .to_str()
                        .ok()
                        .map(|value| (name.to_string(), value.to_owned()))
                })
                .collect();
            if response
                .content_length()
                .is_some_and(|size| size > request.max_bytes as u64)
            {
                return Err(Error::Limit("HTTP response bytes".into()));
            }
            let mut stream = response.bytes_stream();
            let mut bytes = Vec::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|_| Error::Network("Download interrupted".into()))?;
                if bytes
                    .len()
                    .checked_add(chunk.len())
                    .is_none_or(|size| size > request.max_bytes)
                {
                    return Err(Error::Limit("HTTP response bytes".into()));
                }
                bytes.extend_from_slice(&chunk);
            }
            return Ok(HttpResponse {
                status,
                headers,
                body: bytes,
            });
        }
    }
}

#[async_trait(?Send)]
impl HttpTransport for NativeTransport {
    async fn request(&self, request: HttpRequest) -> Result<HttpResponse, Error> {
        let cancelled = async {
            loop {
                if self.cancelled.load(Ordering::Relaxed) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        };
        tokio::select! {
            response = self.perform(request) => response,
            _ = cancelled => Err(Error::Cancelled),
        }
    }
}

fn credential_origin(url: &Url) -> bool {
    matches!(
        url.host_str(),
        Some("api.curseforge.com" | "edge.forgecdn.net")
    )
}

fn validate_url(url: &Url) -> Result<(), Error> {
    if url.scheme() != "https"
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || !matches!(
            url.host_str(),
            Some(
                "api.modrinth.com"
                    | "cdn.modrinth.com"
                    | "api.curseforge.com"
                    | "edge.forgecdn.net"
                    | "mediafilez.forgecdn.net"
                    | "media.forgecdn.net"
            )
        )
    {
        return Err(Error::Network("Untrusted provider URL".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_trusted_https_origins() {
        for url in [
            "http://api.modrinth.com/v2",
            "https://api.modrinth.com.evil.test/",
            "https://127.0.0.1/",
            "https://api.modrinth.com:8080/",
            "https://user@api.modrinth.com/",
        ] {
            assert!(validate_url(&Url::parse(url).unwrap()).is_err());
        }
        assert!(
            validate_url(&Url::parse("https://cdn.modrinth.com/data/test.jar").unwrap()).is_ok()
        );
    }
    #[test]
    fn key_is_only_for_curseforge_auth_origins() {
        assert!(!credential_origin(
            &Url::parse("https://cdn.modrinth.com/").unwrap()
        ));
        assert!(!credential_origin(
            &Url::parse("https://mediafilez.forgecdn.net/").unwrap()
        ));
        assert!(credential_origin(
            &Url::parse("https://edge.forgecdn.net/").unwrap()
        ));
    }
}

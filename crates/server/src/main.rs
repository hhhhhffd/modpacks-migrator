mod jobs;
mod transport;

use axum::{Router, routing::get};
use serde_json::json;

include!(concat!(env!("OUT_DIR"), "/credentials.rs"));

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let bind =
        std::env::var("MODPACKS_MIGRATOR_BIND").unwrap_or_else(|_| "127.0.0.1:8080".to_owned());
    let upload_mib: u64 = std::env::var("MODPACKS_MIGRATOR_MAX_UPLOAD_MIB")
        .unwrap_or_else(|_| "256".into())
        .parse()
        .map_err(|_| "MODPACKS_MIGRATOR_MAX_UPLOAD_MIB must be a positive integer")?;
    if upload_mib == 0 || upload_mib > 4096 {
        return Err("MODPACKS_MIGRATOR_MAX_UPLOAD_MIB must be between 1 and 4096".into());
    }
    let app = Router::new().route("/health", get(|| async {
        axum::Json(json!({"status":"ok","name":"modpacks-migrator","version":env!("CARGO_PKG_VERSION"),"curseforgeEnabled":CURSEFORGE_API_KEY.is_some()}))
    })).merge(jobs::router(CURSEFORGE_API_KEY.map(str::to_owned),upload_mib*1024*1024)?);
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    eprintln!("modpacks-migrator HTTP API listening on http://{bind}");
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            if let Err(error) = tokio::signal::ctrl_c().await {
                eprintln!("Shutdown signal handler failed: {error}");
            }
        })
        .await?;
    Ok(())
}

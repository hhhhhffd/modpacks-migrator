#[path = "../../build-support/credentials.rs"]
mod credentials;

fn main() {
    credentials::generate();
}

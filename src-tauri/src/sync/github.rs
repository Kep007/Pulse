//! Minimal GitHub REST client for the sync: read the repository tree, fetch
//! blobs, and publish several file changes as one commit through the Git
//! Data API (one commit per sync, however many days changed).

use base64::Engine;
use reqwest::{Client, Method, StatusCode};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

const API: &str = "https://api.github.com";

pub struct GitHub {
    client: Client,
    repo: String,
    token: String,
}

pub struct Head {
    pub branch: String,
    pub commit_sha: String,
    pub tree_sha: String,
}

#[derive(Debug, Deserialize)]
pub struct TreeItem {
    pub path: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub sha: String,
}

#[derive(Debug)]
pub enum PushError {
    /// The branch moved (the other PC pushed meanwhile) — retry on the new head.
    Conflict,
    Other(String),
}

#[derive(Deserialize)]
struct RepoInfo {
    default_branch: String,
}

#[derive(Deserialize)]
struct RefInfo {
    object: ShaOnly,
}

#[derive(Deserialize)]
struct CommitInfo {
    tree: ShaOnly,
}

#[derive(Deserialize)]
struct ShaOnly {
    sha: String,
}

#[derive(Deserialize)]
struct TreeInfo {
    tree: Vec<TreeItem>,
    truncated: bool,
}

#[derive(Deserialize)]
struct BlobInfo {
    content: String,
}

fn describe(status: StatusCode) -> String {
    match status {
        StatusCode::UNAUTHORIZED => "Token GitHub non valido o scaduto.".to_string(),
        StatusCode::FORBIDDEN => {
            "Il token non ha i permessi per questo repository (serve Contents: lettura e scrittura).".to_string()
        }
        StatusCode::NOT_FOUND => {
            "Repository non trovato: controlla il nome (utente/repository) e che il token vi abbia accesso.".to_string()
        }
        StatusCode::CONFLICT => "Il repository è vuoto: crealo con almeno un file (es. README).".to_string(),
        other => format!("GitHub ha risposto {other}."),
    }
}

impl GitHub {
    pub fn new(repo: &str, token: &str) -> Result<Self, String> {
        // Same TLS stack the updater uses (rustls without a bundled provider):
        // install ring once if nobody has yet.
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
        let client = Client::builder()
            .user_agent(concat!("Pulse/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|err| err.to_string())?;
        Ok(GitHub {
            client,
            repo: repo.to_string(),
            token: token.to_string(),
        })
    }

    async fn call<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T, (StatusCode, String)> {
        let mut request = self
            .client
            .request(method, format!("{API}/repos/{}{path}", self.repo))
            .bearer_auth(&self.token)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28");
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .map_err(|err| (StatusCode::SERVICE_UNAVAILABLE, format!("Connessione a GitHub non riuscita: {err}")))?;
        let status = response.status();
        if !status.is_success() {
            return Err((status, describe(status)));
        }
        response
            .json::<T>()
            .await
            .map_err(|err| (status, format!("Risposta di GitHub non valida: {err}")))
    }

    async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        self.call(Method::GET, path, None).await.map_err(|(_, message)| message)
    }

    pub async fn head(&self) -> Result<Head, String> {
        let repo: RepoInfo = self.get("").await?;
        let reference: RefInfo = self
            .get(&format!("/git/ref/heads/{}", repo.default_branch))
            .await?;
        let commit: CommitInfo = self
            .get(&format!("/git/commits/{}", reference.object.sha))
            .await?;
        Ok(Head {
            branch: repo.default_branch,
            commit_sha: reference.object.sha,
            tree_sha: commit.tree.sha,
        })
    }

    pub async fn tree(&self, tree_sha: &str) -> Result<Vec<TreeItem>, String> {
        let tree: TreeInfo = self
            .get(&format!("/git/trees/{tree_sha}?recursive=1"))
            .await?;
        if tree.truncated {
            return Err("Il repository è troppo grande per essere letto in una volta.".to_string());
        }
        Ok(tree.tree.into_iter().filter(|item| item.kind == "blob").collect())
    }

    pub async fn blob(&self, sha: &str) -> Result<Vec<u8>, String> {
        let blob: BlobInfo = self.get(&format!("/git/blobs/{sha}")).await?;
        base64::engine::general_purpose::STANDARD
            .decode(blob.content.replace(['\n', '\r'], ""))
            .map_err(|err| format!("Contenuto non valido da GitHub: {err}"))
    }

    /// Writes (`Some(content)`) or deletes (`None`) every path in one commit
    /// on top of `head`, then fast-forwards the branch to it.
    pub async fn commit_files(
        &self,
        head: &Head,
        changes: &[(String, Option<String>)],
        message: &str,
    ) -> Result<(), PushError> {
        let entries: Vec<serde_json::Value> = changes
            .iter()
            .map(|(path, content)| match content {
                Some(content) => json!({ "path": path, "mode": "100644", "type": "blob", "content": content }),
                None => json!({ "path": path, "mode": "100644", "type": "blob", "sha": null }),
            })
            .collect();
        let other = |(_, message): (StatusCode, String)| PushError::Other(message);

        let tree: ShaOnly = self
            .call(
                Method::POST,
                "/git/trees",
                Some(json!({ "base_tree": head.tree_sha, "tree": entries })),
            )
            .await
            .map_err(other)?;
        let commit: ShaOnly = self
            .call(
                Method::POST,
                "/git/commits",
                Some(json!({ "message": message, "tree": tree.sha, "parents": [head.commit_sha] })),
            )
            .await
            .map_err(other)?;
        match self
            .call::<serde_json::Value>(
                Method::PATCH,
                &format!("/git/refs/heads/{}", head.branch),
                Some(json!({ "sha": commit.sha, "force": false })),
            )
            .await
        {
            Ok(_) => Ok(()),
            Err((StatusCode::UNPROCESSABLE_ENTITY, _)) | Err((StatusCode::CONFLICT, _)) => {
                Err(PushError::Conflict)
            }
            Err(err) => Err(other(err)),
        }
    }
}

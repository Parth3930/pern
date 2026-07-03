use reqwest::Client;
use regex::Regex;

#[tokio::main]
async fn main() {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .unwrap();

    let res = client
        .get("https://html.duckduckgo.com/html/")
        .query(&[("q", "rust programming")])
        .send()
        .await
        .unwrap();

    let text = res.text().await.unwrap();

    let re_title = Regex::new(r#"<a class="result__url" href="[^"]+">([^<]+)</a>"#).unwrap();
    let re_snippet = Regex::new(r#"<a class="result__snippet[^>]+>([^<]+)</a>"#).unwrap();

    let titles: Vec<_> = re_title.captures_iter(&text).map(|c| c[1].to_string()).collect();
    let snippets: Vec<_> = re_snippet.captures_iter(&text).map(|c| c[1].to_string()).collect();

    for (t, s) in titles.iter().zip(snippets.iter()) {
        println!("Title: {}\nSnippet: {}\n", t.trim(), s.trim());
    }
}

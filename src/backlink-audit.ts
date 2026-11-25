export function buildApprovedDisavowFile(sourceUrls: string[]): { content: string; domains: string[] } {
  const domains = [...new Set(sourceUrls.map((value) => {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error("An approved referring-page URL is invalid; the disavow file was not generated."); }
    if (!(["http:", "https:"].includes(url.protocol)) || !url.hostname || url.username || url.password) throw new Error("An approved referring-page URL is not an HTTP(S) URL.");
    const host = url.hostname.toLowerCase().replace(/^www\./u, "");
    if (host.length > 2048) throw new Error("A referring domain exceeds Google's maximum URL length.");
    return host;
  }))].sort();
  if (domains.length > 99_999) throw new Error("The approved domain list exceeds Google's 100,000-line file limit.");
  const content = ["# Searchlight export: each domain was explicitly approved for disavow review.", ...domains.map((domain) => `domain:${domain}`)].join("\n") + "\n";
  if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) throw new Error("The disavow file exceeds Google's 2 MiB file limit.");
  return { content, domains };
}

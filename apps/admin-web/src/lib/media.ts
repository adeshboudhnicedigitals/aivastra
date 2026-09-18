// Every job's output is a PNG/WebP except catalog-video jobs, whose result is
// an .mp4 (apps/dispatcher's keys.videoOutput) — an <img> can't render that,
// so every place that previews a job's output needs to know which element to
// use. Strips the query string first since these URLs are presigned R2 GETs.
export function isVideoUrl(url: string): boolean {
  const path = url.split('?')[0].split('#')[0];
  return /\.(mp4|webm|mov|m4v)$/i.test(path);
}

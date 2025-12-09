export default async function handler(req, res) {
  const target = req.query.url;

  if (!target) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  try {
    const response = await fetch(target);
    if (!response.ok) {
      return res.status(500).json({ error: "Failed to fetch target" });
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      base64,
      mime: response.headers.get("content-type") || "image/png"
    });

  } catch (err) {
    res.status(500).json({ error: err.message || "Proxy error" });
  }
}

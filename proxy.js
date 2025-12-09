export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: "Missing url" });

  try {
    const response = await fetch(url);
    const array = await response.arrayBuffer();
    const base64 = Buffer.from(array).toString("base64");

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      base64,
      mime: response.headers.get("content-type") || "image/png"
    });

  } catch (err) {
    res.status(500).json({ error: err.message || "Proxy failed" });
  }
}

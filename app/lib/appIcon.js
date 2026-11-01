const axios = require("axios");
function validIconURL(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (/^(?:play-lh|lh[0-9]+)\.googleusercontent\.com$/.test(url.hostname) ||
        /^is[0-9]+(?:-ssl)?\.mzstatic\.com$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}
async function fetchIcon(url) {
  if (!validIconURL(url)) throw new Error("INVALID_ICON_URL");
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 8000,
    maxRedirects: 0,
    maxContentLength: 2 * 1024 * 1024,
  });
  const type = String(response.headers["content-type"] || "").split(";")[0];
  if (!["image/png", "image/jpeg", "image/webp", "image/avif"].includes(type))
    throw new Error("INVALID_ICON_TYPE");
  return { data: response.data, type };
}
module.exports = { fetchIcon, validIconURL };

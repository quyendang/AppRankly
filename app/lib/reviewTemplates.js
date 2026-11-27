const { db } = require("./db");
const { redact } = require("./runtime");

function list() {
  return db.prepare("SELECT id,name,body FROM reply_template ORDER BY id").all();
}
function create(input) {
  const name = String(input?.name || "").trim(), body = String(input?.body || "").trim();
  if (!name || name.length > 60 || !body || body.length > 5970 || redact(body) !== body ||
      db.prepare("SELECT COUNT(*) n FROM reply_template").get().n >= 30)
    throw new Error("INVALID_INPUT");
  const info = db.prepare("INSERT INTO reply_template(name,body) VALUES(?,?)").run(name, body);
  return { id: Number(info.lastInsertRowid), name, body };
}
function remove(id) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("INVALID_INPUT");
  db.prepare("DELETE FROM reply_template WHERE id=?").run(id);
}
module.exports = { list, create, remove };

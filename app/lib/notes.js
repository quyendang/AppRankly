const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { DATA_DIR, redact } = require("./runtime");
const { db } = require("./db");
const NOTES_DIR = path.join(DATA_DIR, "notes");

function safePath(target, file = false) {
  const relative = path.relative(DATA_DIR, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("UNSAFE_NOTE_PATH");
  let current = DATA_DIR;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink())
      throw new Error("UNSAFE_NOTE_PATH");
  }
  if (file && !fs.statSync(target).isFile())
    throw new Error("UNSAFE_NOTE_PATH");
  return target;
}
function validId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,119}$/.test(id))
    throw new Error("INVALID_NOTE_ID");
  return id;
}
function directory() {
  fs.mkdirSync(NOTES_DIR, { recursive: true, mode: 0o700 });
  safePath(NOTES_DIR);
}
function parseNoteMarkdown(rawText) {
  if (!rawText || typeof rawText !== "string")
    return { metadata: {}, content: "" };

  const match = rawText.match(
    /^---\s*[\r\n]+([\s\S]*?)[\r\n]+---\s*[\r\n]*([\s\S]*)$/,
  );
  if (!match) return { metadata: {}, content: rawText.trim() };

  const rawHeader = match[1];
  const content = match[2].trim();
  const metadata = {};

  rawHeader.split(/\r?\n/).forEach((line) => {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();

      if (val === "true") val = true;
      else if (val === "false") val = false;
      else if (val.startsWith("[") && val.endsWith("]")) {
        try {
          val = JSON.parse(val);
        } catch (e) {
          val = [];
        }
      } else if (val.startsWith('"') && val.endsWith('"')) {
        val = val.slice(1, -1).replace(/\\"/g, '"');
      }
      metadata[key] = val;
    }
  });

  return { metadata, content };
}

function stringifyNoteMarkdown(note) {
  const meta = {
    id: note.id,
    title: note.title || "Untitled Note",
    packageName: note.packageName || "all",
    platform: note.platform || "all",
    tags: Array.isArray(note.tags) ? note.tags : [],
    pinned: Boolean(note.pinned),
    createdAt: note.createdAt || new Date().toISOString(),
    updatedAt: note.updatedAt || new Date().toISOString(),
  };

  const metaLines = ["---"];
  Object.entries(meta).forEach(([key, value]) => {
    if (typeof value === "string") {
      metaLines.push(`${key}: "${value.replace(/"/g, '\\"')}"`);
    } else if (Array.isArray(value)) {
      metaLines.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      metaLines.push(`${key}: ${value}`);
    }
  });
  metaLines.push("---", "", note.content || "");
  return metaLines.join("\n");
}

async function getNotesFromStorage() {
  directory();
  const notes = [];
  const read = (file, pkg) => {
    try {
      const raw = fs.readFileSync(safePath(file, true), "utf8");
      const { metadata, content } = parseNoteMarkdown(raw);
      const id = validId(String(metadata.id || path.basename(file, ".md")));
      notes.push({
        id,
        title: String(metadata.title || id),
        content: redact(content),
        packageName: metadata.packageName || pkg,
        platform: metadata.platform || "all",
        tags: Array.isArray(metadata.tags) ? metadata.tags : [],
        pinned: metadata.pinned === true,
        createdAt:
          metadata.createdAt || fs.statSync(file).birthtime.toISOString(),
        updatedAt: metadata.updatedAt || fs.statSync(file).mtime.toISOString(),
      });
    } catch (error) {
      if (
        error.message !== "UNSAFE_NOTE_PATH" &&
        error.message !== "INVALID_NOTE_ID"
      )
        throw error;
    }
  };
  for (const item of fs.readdirSync(NOTES_DIR, { withFileTypes: true })) {
    if (item.isSymbolicLink() || item.name === ".git") continue;
    const entry = path.join(NOTES_DIR, item.name);
    if (item.isFile() && item.name.endsWith(".md")) read(entry, "all");
    else if (item.isDirectory()) {
      safePath(entry);
      for (const name of fs.readdirSync(entry))
        if (name.endsWith(".md"))
          read(
            path.join(entry, name),
            item.name === "_global" ? "all" : item.name,
          );
    }
  }
  // Preserve notes already present only in SQLite, without importing any Git state.
  if (db)
    for (const row of db.prepare("SELECT * FROM notes").all()) {
      if (!notes.some((n) => n.id === row.id))
        notes.push({
          id: row.id,
          title: row.title,
          content: redact(row.content),
          packageName: row.package_name,
          platform: row.platform,
          tags: JSON.parse(row.tags_json || "[]"),
          pinned: !!row.pinned,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
    }
  return notes.sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}
async function saveNoteToStorage(note) {
  directory();
  const id = validId(note.id);
  if (
    typeof note.title !== "string" ||
    !note.title.trim() ||
    note.title.length > 150 ||
    /[\r\n\x00-\x1f]/.test(note.title) ||
    typeof note.content !== "string" ||
    note.content.length > 20000
  )
    throw new Error("INVALID_NOTE");
  if (
    redact(note.content) !== note.content ||
    redact(note.title) !== note.title
  )
    throw new Error("INVALID_NOTE");
  const existing = await getNotesFromStorage();
  const found = existing.find((n) => n.id === id);
  // Keep a note's original directory on update so legacy notes are never duplicated.
  let file = path.join(NOTES_DIR, id + ".md");
  if (found) {
    const candidates = [
      file,
      path.join(
        NOTES_DIR,
        found.packageName === "all" ? "_global" : found.packageName,
        id + ".md",
      ),
    ];
    file = candidates.find((candidate) => fs.existsSync(candidate)) || file;
  }
  if (fs.existsSync(file)) safePath(file, true);
  safePath(path.dirname(file));
  const tmp = path.join(path.dirname(file), crypto.randomUUID() + ".tmp");
  fs.writeFileSync(tmp, stringifyNoteMarkdown({ ...note, id }), {
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(tmp, file);
  if (db)
    db.prepare(
      `INSERT INTO notes(id,package_name,platform,title,content,tags_json,pinned,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,tags_json=excluded.tags_json,pinned=excluded.pinned,updated_at=excluded.updated_at`,
    ).run(
      id,
      note.packageName || "all",
      note.platform || "all",
      note.title,
      note.content,
      JSON.stringify(note.tags || []),
      note.pinned ? 1 : 0,
      note.createdAt,
      note.updatedAt,
    );
}
async function deleteNoteFromStorage(id) {
  validId(id);
  directory();
  const files = [path.join(NOTES_DIR, id + ".md")];
  for (const dir of fs.readdirSync(NOTES_DIR, { withFileTypes: true }))
    if (dir.isDirectory() && dir.name !== ".git")
      files.push(path.join(NOTES_DIR, dir.name, id + ".md"));
  for (const file of files)
    if (fs.existsSync(file)) fs.unlinkSync(safePath(file, true));
  if (db) db.prepare("DELETE FROM notes WHERE id=?").run(id);
}
module.exports = {
  NOTES_DIR,
  getNotesFromStorage,
  saveNoteToStorage,
  deleteNoteFromStorage,
  parseNoteMarkdown,
  stringifyNoteMarkdown,
};

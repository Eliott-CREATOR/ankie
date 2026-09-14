// RFC 4180-style parser: quoted fields, doubled quotes, CRLF or LF. Second copy of the one in
// apps/worker/scripts/seed.mjs (that one is a Node script, this runs in the Worker) — two
// duplications, not three, so no shared module yet (CLAUDE.md rule 1).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") {
        i++;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

// Header row → one record per data row. Missing trailing cells read as "".
export function csvToRecords(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  const header = rows[0];
  if (!header) {
    return [];
  }
  return rows
    .slice(1)
    .map((cols) =>
      Object.fromEntries(header.map((name, idx) => [name.trim(), (cols[idx] ?? "").trim()])),
    );
}

import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { stringifyJson } from "../helpers/jsonCol.js";
import { assertSupportedCombo, assertSupportedModel, isRetiredModel } from "open-sse/config/retiredModels.js";

function parseModels(raw) {
  if (raw == null) return { models: [], parseError: null };
  if (Array.isArray(raw)) return { models: raw, parseError: null };
  if (typeof raw !== "string") return { models: [], parseError: "models must be JSON array text" };
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { models: [], parseError: "models must be a JSON array" };
    return { models: parsed, parseError: null };
  } catch (error) {
    return { models: [], parseError: error?.message || "models JSON is malformed" };
  }
}

function classifyCombo(combo, parseError = null) {
  const models = Array.isArray(combo.models) ? combo.models : [];
  const invalidModels = [
    ...(isRetiredModel(combo.name) ? [combo.name] : []),
    ...models.filter(isRetiredModel),
  ];
  return {
    ...combo,
    validity: parseError ? "malformed" : invalidModels.length > 0 ? "retired" : "valid",
    invalidModels,
    ...(parseError ? { parseError } : {}),
  };
}

function rowToCombo(row) {
  if (!row) return null;
  const { models, parseError } = parseModels(row.models);
  const combo = {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  return classifyCombo(combo, parseError);
}

export async function getCombos() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  assertSupportedModel(name);
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM combos WHERE name = ?`, [name]);
  return rowToCombo(row);
}

export async function createCombo(data) {
  assertSupportedCombo({ name: data.name, models: data.models || [] });
  const db = await getAdapter();
  const now = new Date().toISOString();
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
  );
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM combos WHERE id = ?`, [id]);
    if (!row) return;
    const current = rowToCombo(row);
    if (current.validity === "malformed" && !Object.prototype.hasOwnProperty.call(data, "models")) {
      const error = new Error("Malformed combo rows require a complete models replacement");
      error.code = "MALFORMED_COMBO";
      error.status = 400;
      throw error;
    }
    const merged = {
      name: data.name ?? current.name,
      kind: data.kind ?? current.kind,
      models: data.models ?? current.models,
      updatedAt: new Date().toISOString(),
    };
    assertSupportedCombo(merged);
    db.run(
      `UPDATE combos SET name = ?, kind = ?, models = ?, updatedAt = ? WHERE id = ?`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = classifyCombo({ id, ...merged });
  });
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM combos WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

import { getRawDb } from "../db";
import { orangeMaterials, proconectMaterials } from "./orange-materials";
import type { InterventionMaterialSelection } from "./field-documentation";
import type { AuthenticatedAccount } from "./server-auth";

const catalog = new Map(
  [
    ...orangeMaterials.map((item) => ({ ...item, source: "orange" as const })),
    ...proconectMaterials.map((item) => ({ ...item, source: "proconect" as const })),
  ].map((item) => [`${item.source}:${item.code}`, item]),
);

function normalizedName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 120) : "";
}

export async function listInventory() {
  const [warehouses, technicians, inventory, movements] = await Promise.all([
    getRawDb().prepare("SELECT id, name, active FROM warehouses ORDER BY name").all(),
    getRawDb().prepare("SELECT u.username, u.name, tw.warehouse_id FROM app_users u LEFT JOIN technician_warehouses tw ON tw.technician_username = u.username WHERE u.role = 'Tehnician' AND u.active = 1 ORDER BY u.name").all(),
    getRawDb().prepare("SELECT warehouse_id, source, material_code AS code, description, unit, quantity, updated_at FROM warehouse_inventory ORDER BY warehouse_id, description").all(),
    getRawDb().prepare("SELECT id, warehouse_id, source, material_code AS code, description, unit, quantity_delta, reason, project_id, created_by, created_at FROM inventory_movements ORDER BY created_at DESC LIMIT 200").all(),
  ]);
  return {
    warehouses: warehouses.results ?? [],
    technicians: technicians.results ?? [],
    inventory: inventory.results ?? [],
    movements: movements.results ?? [],
    catalog: [...catalog.values()],
  };
}

export async function createWarehouse(nameInput: unknown, account: AuthenticatedAccount) {
  const name = normalizedName(nameInput);
  if (name.length < 2) return { error: "Denumirea magaziei trebuie să aibă minimum 2 caractere.", status: 400 as const };
  const existing = await getRawDb().prepare("SELECT id FROM warehouses WHERE lower(name) = lower(?) LIMIT 1").bind(name).first();
  if (existing) return { error: "Magazia există deja.", status: 409 as const };
  const id = crypto.randomUUID();
  const now = Date.now();
  await getRawDb().prepare("INSERT INTO warehouses (id, name, active, created_by, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)").bind(id, name, account.username, now, now).run();
  return { warehouse: { id, name, active: 1 } };
}

export async function assignTechnicianWarehouse(usernameInput: unknown, warehouseIdInput: unknown, account: AuthenticatedAccount) {
  const username = typeof usernameInput === "string" ? usernameInput.trim().toLowerCase() : "";
  const warehouseId = typeof warehouseIdInput === "string" ? warehouseIdInput.trim() : "";
  const [technician, warehouse] = await Promise.all([
    getRawDb().prepare("SELECT username FROM app_users WHERE username = ? AND role = 'Tehnician' AND active = 1").bind(username).first(),
    getRawDb().prepare("SELECT id FROM warehouses WHERE id = ? AND active = 1").bind(warehouseId).first(),
  ]);
  if (!technician || !warehouse) return { error: "Tehnicianul sau magazia selectată nu este validă.", status: 400 as const };
  await getRawDb().prepare("INSERT INTO technician_warehouses (technician_username, warehouse_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?) ON CONFLICT(technician_username) DO UPDATE SET warehouse_id = excluded.warehouse_id, assigned_by = excluded.assigned_by, assigned_at = excluded.assigned_at").bind(username, warehouseId, account.username, Date.now()).run();
  return { assigned: true };
}

export async function adjustInventory(input: { warehouseId?: unknown; source?: unknown; code?: unknown; quantity?: unknown; reason?: unknown }, account: AuthenticatedAccount) {
  const warehouseId = typeof input.warehouseId === "string" ? input.warehouseId.trim() : "";
  const source = input.source === "orange" || input.source === "proconect" ? input.source : "";
  const code = typeof input.code === "string" ? input.code.trim() : "";
  const quantity = Number(input.quantity);
  const reason = normalizedName(input.reason) || "Alimentare / corecție manuală";
  const item = catalog.get(`${source}:${code}`);
  if (!item || !warehouseId || !Number.isFinite(quantity) || quantity === 0 || Math.abs(quantity) > 1_000_000_000) {
    return { error: "Magazia, materialul și cantitatea trebuie completate corect.", status: 400 as const };
  }
  const warehouse = await getRawDb().prepare("SELECT id FROM warehouses WHERE id = ? AND active = 1").bind(warehouseId).first();
  if (!warehouse) return { error: "Magazia selectată nu există.", status: 404 as const };
  const now = Date.now();
  await getRawDb().batch([
    getRawDb().prepare("INSERT INTO warehouse_inventory (warehouse_id, source, material_code, description, unit, quantity, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(warehouse_id, source, material_code) DO UPDATE SET quantity = warehouse_inventory.quantity + excluded.quantity, description = excluded.description, unit = excluded.unit, updated_at = excluded.updated_at").bind(warehouseId, source, item.code, item.description, item.unit, quantity, now),
    getRawDb().prepare("INSERT INTO inventory_movements (id, warehouse_id, source, material_code, description, unit, quantity_delta, reason, project_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)").bind(crypto.randomUUID(), warehouseId, source, item.code, item.description, item.unit, quantity, reason, account.username, now),
  ]);
  return { adjusted: true };
}

export async function buildInterventionConsumptionStatements(projectId: string, technicianUsername: string, materials: InterventionMaterialSelection[], account: AuthenticatedAccount, now: number, selectedWarehouseId?: string) {
  if (!materials.length) return { statements: [] as D1PreparedStatement[] };
  const warehouse = selectedWarehouseId
    ? await getRawDb().prepare("SELECT id, name FROM warehouses WHERE id = ? AND active = 1 LIMIT 1").bind(selectedWarehouseId).first<{ id: string; name: string }>()
    : await getRawDb().prepare("SELECT w.id, w.name FROM technician_warehouses tw INNER JOIN warehouses w ON w.id = tw.warehouse_id WHERE tw.technician_username = ? AND w.active = 1 LIMIT 1").bind(technicianUsername).first<{ id: string; name: string }>();
  if (!warehouse) return { error: selectedWarehouseId ? "Magazia selectată pentru consum nu este disponibilă." : "Tehnicianul intervenției nu este alocat unei magazii. Configurează alocarea în Management → Materiale.", status: 409 as const };

  const existing = await getRawDb().prepare("SELECT project_id FROM project_inventory_consumption WHERE project_id = ? LIMIT 1").bind(projectId).first();
  if (existing) return { statements: [] as D1PreparedStatement[] };

  const statements: D1PreparedStatement[] = [];
  for (const material of materials) {
    const item = catalog.get(`${material.source}:${material.code}`);
    if (!item || !Number.isFinite(material.quantity) || material.quantity <= 0) {
      return { error: `Material invalid în intervenție: ${material.code || "fără cod"}.`, status: 400 as const };
    }
    const delta = -material.quantity;
    statements.push(
      getRawDb().prepare("INSERT INTO warehouse_inventory (warehouse_id, source, material_code, description, unit, quantity, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(warehouse_id, source, material_code) DO UPDATE SET quantity = warehouse_inventory.quantity + excluded.quantity, description = excluded.description, unit = excluded.unit, updated_at = excluded.updated_at").bind(warehouse.id, material.source, item.code, item.description, item.unit, delta, now),
      getRawDb().prepare("INSERT INTO inventory_movements (id, warehouse_id, source, material_code, description, unit, quantity_delta, reason, project_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), warehouse.id, material.source, item.code, item.description, item.unit, delta, `Consum intervenție ${projectId}`, projectId, account.username, now),
      getRawDb().prepare("INSERT INTO project_inventory_consumption (project_id, warehouse_id, source, material_code, description, unit, quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(projectId, warehouse.id, material.source, item.code, item.description, item.unit, material.quantity, now),
    );
  }
  return { statements };
}

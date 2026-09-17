CREATE TABLE IF NOT EXISTS warehouses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS technician_warehouses (
  technician_username TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at INTEGER NOT NULL,
  FOREIGN KEY (technician_username) REFERENCES app_users(username) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS warehouse_inventory (
  warehouse_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('orange', 'proconect')),
  material_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (warehouse_id, source, material_code),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id TEXT PRIMARY KEY,
  warehouse_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('orange', 'proconect')),
  material_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity_delta REAL NOT NULL,
  reason TEXT NOT NULL,
  project_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS inventory_movements_warehouse_created_idx
ON inventory_movements (warehouse_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_inventory_consumption (
  project_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('orange', 'proconect')),
  material_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, source, material_code),
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
);

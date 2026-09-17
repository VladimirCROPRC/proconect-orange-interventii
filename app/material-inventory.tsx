"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type Warehouse = { id: string; name: string; active: number };
type Technician = { username: string; name: string; warehouse_id?: string | null };
type CatalogItem = { source: "orange" | "proconect"; code: string; description: string; unit: string };
type InventoryRow = CatalogItem & { warehouse_id: string; quantity: number };
type Movement = InventoryRow & { id: string; quantity_delta: number; reason: string; project_id?: string | null; created_by: string; created_at: number };

type InventoryPayload = {
  warehouses: Warehouse[];
  technicians: Technician[];
  catalog: CatalogItem[];
  inventory: InventoryRow[];
  movements: Movement[];
  error?: string;
};

export function MaterialInventory({ onNotify }: { onNotify: (message: string) => void }) {
  const [data, setData] = useState<InventoryPayload>({ warehouses: [], technicians: [], catalog: [], inventory: [], movements: [] });
  const [warehouseId, setWarehouseId] = useState("");
  const [source, setSource] = useState<"orange" | "proconect">("orange");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/materials", { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json() as InventoryPayload;
      if (!response.ok) throw new Error(payload.error || "Inventarul nu poate fi încărcat.");
      setData(payload);
      setWarehouseId((current) => current || payload.warehouses[0]?.id || "");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Inventarul nu poate fi încărcat.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function submit(body: Record<string, unknown>, success: string) {
    setSaving(true);
    try {
      const response = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Operațiunea nu a reușit.");
      onNotify(success);
      await refresh();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Operațiunea nu a reușit.");
    } finally {
      setSaving(false);
    }
  }

  const visibleInventory = useMemo(() => data.inventory.filter((row) =>
    (!warehouseId || row.warehouse_id === warehouseId)
    && (!search || `${row.code} ${row.description}`.toLowerCase().includes(search.toLowerCase()))
  ), [data.inventory, warehouseId, search]);

  const catalog = data.catalog.filter((item) => item.source === source);

  return <div className="inventory-page">
    <div className="page-heading">
      <div><span className="eyebrow">MANAGEMENT STOCURI</span><h1>Materiale</h1><p>Alimentează magaziile, alocă tehnicienii și urmărește consumul intervențiilor Orange.</p></div>
      <button className="secondary-button" onClick={() => void refresh()} disabled={loading}>↻ Actualizează</button>
    </div>

    <div className="inventory-grid">
      <form className="inventory-card" onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void submit({ action: "create-warehouse", name: form.get("name") }, "Magazia a fost creată.");
        event.currentTarget.reset();
      }}>
        <h3>Magazii</h3><p>Creează punctele din care sunt alimentate echipele.</p>
        <label><span>Denumire magazie</span><input name="name" required minLength={2} placeholder="ex. Magazia Cluj" /></label>
        <button className="primary-button" disabled={saving}>Adaugă magazie</button>
        <div className="inventory-tags">{data.warehouses.map((warehouse) => <span key={warehouse.id}>{warehouse.name}</span>)}</div>
      </form>

      <form className="inventory-card" onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void submit({ action: "assign-technician", username: form.get("username"), warehouseId: form.get("warehouseId") }, "Tehnicianul a fost alocat magaziei.");
      }}>
        <h3>Alocare tehnicieni</h3><p>Consumul se scade din magazia tehnicianului alocat tichetului.</p>
        <label><span>Tehnician</span><select name="username" required defaultValue=""><option value="" disabled>Selectează</option>{data.technicians.map((item) => <option key={item.username} value={item.username}>{item.name}</option>)}</select></label>
        <label><span>Magazie</span><select name="warehouseId" required defaultValue=""><option value="" disabled>Selectează</option>{data.warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button className="primary-button" disabled={saving || !data.warehouses.length}>Salvează alocarea</button>
        <div className="inventory-assignments">{data.technicians.map((tech) => <div key={tech.username}><b>{tech.name}</b><span>{data.warehouses.find((warehouse) => warehouse.id === tech.warehouse_id)?.name || "Nealocat"}</span></div>)}</div>
      </form>

      <form className="inventory-card inventory-card-wide" onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        void submit({ action: "adjust-stock", warehouseId: form.get("warehouseId"), source: form.get("source"), code: form.get("code"), quantity: Number(form.get("quantity")), reason: form.get("reason") }, "Stocul a fost actualizat.");
        event.currentTarget.reset();
      }}>
        <h3>Alimentare și corecții</h3><p>Folosește cantități pozitive pentru alimentare și negative pentru corecții sau ieșiri manuale.</p>
        <div className="inventory-form-row">
          <label><span>Magazie</span><select name="warehouseId" required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}><option value="" disabled>Selectează</option>{data.warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Categorie</span><select name="source" value={source} onChange={(event) => setSource(event.target.value as "orange" | "proconect")}><option value="orange">Orange</option><option value="proconect">Proconect</option></select></label>
          <label className="inventory-material-select"><span>Material</span><select name="code" required defaultValue=""><option value="" disabled>Selectează materialul</option>{catalog.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.description} ({item.unit})</option>)}</select></label>
          <label><span>Cantitate</span><input name="quantity" type="number" step="0.001" required placeholder="+ / -" /></label>
          <label><span>Motiv</span><input name="reason" maxLength={120} placeholder="Alimentare, retur, corecție..." /></label>
        </div>
        <button className="primary-button" disabled={saving || !warehouseId}>Înregistrează mișcarea</button>
      </form>
    </div>

    <section className="inventory-card inventory-table-card">
      <div className="inventory-table-head"><div><h3>Stoc curent</h3><p>Valorile negative sunt permise și sunt evidențiate.</p></div><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Caută după cod sau denumire" /></div>
      <div className="inventory-table">
        <div className="inventory-table-row inventory-table-title"><b>Cod</b><b>Material</b><b>Sursă</b><b>Cantitate</b></div>
        {visibleInventory.map((row) => <div className="inventory-table-row" key={`${row.warehouse_id}:${row.source}:${row.code}`}><span>{row.code}</span><span>{row.description}</span><span>{row.source === "orange" ? "Orange" : "Proconect"}</span><strong className={row.quantity < 0 ? "inventory-negative" : ""}>{row.quantity} {row.unit}</strong></div>)}
        {!visibleInventory.length && <p className="inventory-empty">{loading ? "Se încarcă..." : "Nu există stoc pentru selecția curentă."}</p>}
      </div>
    </section>

    <section className="inventory-card inventory-table-card">
      <h3>Ultimele mișcări</h3>
      <div className="inventory-table">
        {data.movements.filter((row) => !warehouseId || row.warehouse_id === warehouseId).slice(0, 50).map((row) => <div className="inventory-movement" key={row.id}><div><b>{row.code}</b><span>{row.reason}{row.project_id ? ` · ${row.project_id}` : ""}</span></div><strong className={row.quantity_delta < 0 ? "inventory-negative" : ""}>{row.quantity_delta > 0 ? "+" : ""}{row.quantity_delta} {row.unit}</strong><small>{new Date(row.created_at).toLocaleString("ro-RO")} · {row.created_by}</small></div>)}
      </div>
    </section>
  </div>;
}

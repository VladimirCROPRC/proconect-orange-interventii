import { adjustInventory, assignTechnicianWarehouse, createWarehouse, listInventory } from "../../inventory-server";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

function canManage(role: string) {
  return role === "Admin" || role === "Manager" || role === "Coordonator";
}

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!canManage(session.account.role)) return Response.json({ error: "Acces rezervat managementului." }, { status: 403 });
    return Response.json(await listInventory(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Inventory load error:", error);
    return Response.json({ error: "Inventarul nu este disponibil. Aplică migrațiile D1 și reîncearcă." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!canManage(session.account.role)) return Response.json({ error: "Acces rezervat managementului." }, { status: 403 });
    const body = await request.json() as Record<string, unknown>;
    const result = body.action === "create-warehouse"
      ? await createWarehouse(body.name, session.account)
      : body.action === "assign-technician"
        ? await assignTechnicianWarehouse(body.username, body.warehouseId, session.account)
        : body.action === "adjust-stock"
          ? await adjustInventory(body, session.account)
          : { error: "Acțiunea de inventar nu este validă.", status: 400 as const };
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result);
  } catch (error) {
    console.error("Inventory update error:", error);
    return Response.json({ error: "Inventarul nu a putut fi actualizat." }, { status: 503 });
  }
}

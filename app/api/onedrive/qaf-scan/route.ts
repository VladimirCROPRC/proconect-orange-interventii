import { scanOneDriveQafFolder } from "../../../onedrive-server";
import { currentSession, sameOrigin } from "../../../server-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (session.account.role !== "Admin") return Response.json({ error: "Scanarea QAF este disponibilă numai administratorului." }, { status: 403 });
    const body = await request.json() as { folderUrl?: unknown };
    if (typeof body.folderUrl !== "string" || !body.folderUrl.trim()) {
      return Response.json({ error: "Lipește linkul folderului OneDrive sau SharePoint." }, { status: 400 });
    }
    const result = await scanOneDriveQafFolder(body.folderUrl);
    return new Response(result.workbook, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="Centralizator-QAF-scanare-unica.xlsx"',
        "Cache-Control": "no-store",
        "X-QAF-Count": String(result.qafCount),
        "X-QAF-Visited": String(result.visited),
        "X-QAF-Limit-Reached": result.limitReached ? "1" : "0",
      },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Scanarea QAF nu a putut fi finalizată." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

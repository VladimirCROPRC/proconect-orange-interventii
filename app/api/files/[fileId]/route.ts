import { bucket, getAuthorizedProject, getFileRow, hasCompletedProjectSafety, isManagementRole } from "../../../project-server";
import { currentSession } from "../../../server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ fileId: string }> }) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    const { fileId } = await context.params;
    const file = await getFileRow(fileId);
    if (!file || !(await getAuthorizedProject(file.project_id, session.account))) return Response.json({ error: "Fișier indisponibil." }, { status: 404 });
    if (file.section === "documents" && !isManagementRole(session.account)) return Response.json({ error: "Acces rezervat administratorului." }, { status: 403 });
    if (file.section !== "safety" && !(await hasCompletedProjectSafety(file.project_id, session.account))) {
      return Response.json({ error: "Încarcă fotografiile Pretask și EIP înainte de accesarea lucrării." }, { status: 403 });
    }
    const object = await bucket().get(file.storage_key);
    if (!object) return Response.json({ error: "Fișierul nu mai este disponibil." }, { status: 404 });
    const safeName = file.original_name.replace(/[\r\n"]/g, "_");
    return new Response(object.body, {
      headers: {
        "Content-Type": file.content_type,
        "Content-Length": String(object.size),
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch {
    return Response.json({ error: "Fișierul nu a putut fi deschis." }, { status: 503 });
  }
}

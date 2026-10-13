import { createProject, deleteProject, ensureProjectData, isManagementRole, listProjectData, updateProject, writeReport } from "../../project-server";
import { syncProjectIfConnected } from "../../backup-server";
import type { ProjectRecord } from "../../project-data";
import { currentSession, sameOrigin } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    await ensureProjectData();
    return Response.json(await listProjectData(session.account), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Proconect project load error:", error instanceof Error ? error.message : "Unknown project failure");
    return Response.json({ error: "Proiectele nu sunt disponibile momentan." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    const body = (await request.json()) as { project?: ProjectRecord; reportMetadata?: { siteCode?: unknown; lec?: unknown } };
    if (!body.project || typeof body.project !== "object") return Response.json({ error: "Datele proiectului lipsesc." }, { status: 400 });
    const technicianCreatesIntervention = session.account.role === "Tehnician" && body.project.activityType === "Intervenție Orange";
    if (!isManagementRole(session.account) && !technicianCreatesIntervention) {
      return Response.json({ error: "Tehnicienii pot crea numai tichete Orange." }, { status: 403 });
    }
    await ensureProjectData();
    const project = technicianCreatesIntervention
      ? { ...body.project, technician: session.account.name, technicians: [session.account.name] }
      : body.project;
    const result = await createProject(project, session.account);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    const siteCode = typeof body.reportMetadata?.siteCode === "string" ? body.reportMetadata.siteCode.trim().slice(0, 100) : "";
    const lec = typeof body.reportMetadata?.lec === "string" ? body.reportMetadata.lec.trim().slice(0, 100) : "";
    if (siteCode || lec) await writeReport(result.project.id, { siteCode, lec }, session.account);
    try {
      await syncProjectIfConnected(result.project.id);
    } catch (error) {
      console.error("Proconect Drive project sync error:", error instanceof Error ? error.message : "Unknown Drive project sync failure");
    }
    return Response.json({ project: result.project }, { status: 201 });
  } catch (error) {
    console.error("Proconect project create error:", error instanceof Error ? error.message : "Unknown project failure");
    return Response.json({ error: "Proiectul nu a putut fi salvat." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Nu ai permisiunea de a modifica proiecte." }, { status: 403 });
    const body = (await request.json()) as { project?: ProjectRecord };
    if (!body.project || typeof body.project !== "object") return Response.json({ error: "Datele proiectului lipsesc." }, { status: 400 });
    const result = await updateProject(body.project);
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    try {
      await syncProjectIfConnected(result.project.id);
    } catch (error) {
      console.error("Proconect Drive project update sync error:", error instanceof Error ? error.message : "Unknown Drive project sync failure");
    }
    return Response.json({ project: result.project });
  } catch (error) {
    console.error("Proconect project update error:", error instanceof Error ? error.message : "Unknown project update failure");
    return Response.json({ error: "Proiectul nu a putut fi actualizat." }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Cerere neautorizată." }, { status: 403 });
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Nu ai permisiunea de a șterge proiecte." }, { status: 403 });

    const body = (await request.json()) as { projectId?: unknown; projectIds?: unknown };
    const isBulkRequest = Array.isArray(body.projectIds);
    const requestedIds = isBulkRequest ? body.projectIds : [body.projectId];
    if (!requestedIds.length || requestedIds.length > 50 || requestedIds.some((projectId) => typeof projectId !== "string")) {
      return Response.json({ error: "Selectează între 1 și 50 de proiecte pentru ștergere." }, { status: 400 });
    }
    const projectIds = Array.from(new Set((requestedIds as string[]).map((projectId) => projectId.trim().toUpperCase()).filter(Boolean)));
    if (!projectIds.length) return Response.json({ error: "Identificatorul proiectului lipsește." }, { status: 400 });

    if (!isBulkRequest) {
      const result = await deleteProject(projectIds[0]);
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json(result);
    }

    const deletedIds: string[] = [];
    const failures: Array<{ projectId: string; error: string }> = [];
    let cleanupFailures = 0;
    for (const projectId of projectIds) {
      const result = await deleteProject(projectId);
      if ("error" in result) {
        failures.push({ projectId, error: result.error });
      } else {
        deletedIds.push(result.projectId);
        cleanupFailures += result.cleanupFailures;
      }
    }

    return Response.json({ deletedIds, cleanupFailures, failures }, { status: deletedIds.length ? 200 : 400 });
  } catch (error) {
    console.error("Proconect project deletion error:", error instanceof Error ? error.message : "Unknown project deletion failure");
    return Response.json({ error: "Proiectul nu a putut fi șters." }, { status: 503 });
  }
}

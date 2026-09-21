import { buildAllMonthlyReports, buildMonthlySubjectReport, listMonthlyReportSubjects } from "../../monthly-contractor-reports";
import { isManagementRole } from "../../project-server";
import { currentSession } from "../../server-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await currentSession(request);
    if (!session || session.account.passwordResetRequired) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
    if (!isManagementRole(session.account)) return Response.json({ error: "Acces rezervat coordonatorilor." }, { status: 403 });
    const query = new URL(request.url).searchParams;
    const month = query.get("month") ?? "";
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return Response.json({ error: "Selectează o lună validă." }, { status: 400 });
    if (query.get("download") !== "1") return Response.json(await listMonthlyReportSubjects(month), { headers: { "Cache-Control": "no-store" } });

    const rate = Number((query.get("rate") ?? "").replace(",", "."));
    const rateDate = /^\d{4}-\d{2}-\d{2}$/.test(query.get("rateDate") ?? "") ? query.get("rateDate")! : "";
    if (query.get("all") === "1") {
      const report = await buildAllMonthlyReports(month, rate, rateDate);
      return new Response(report.bytes.slice().buffer, {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${report.filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const scope = query.get("scope");
    const subject = query.get("subject") ?? "";
    if ((scope !== "technician" && scope !== "contractor") || !subject) return Response.json({ error: "Selectează tehnicianul sau contractorul." }, { status: 400 });
    const report = await buildMonthlySubjectReport(month, scope, subject, rate, rateDate);
    return new Response(report.bytes.slice().buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${report.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Raportul lunar nu a putut fi generat." }, { status: 503 });
  }
}

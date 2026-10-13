import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

async function load(path, setup = "") {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const code = setup + stripTypeScriptTypes(source.replace(/^import .*;\r?\n/gm, ""), { mode: "transform" });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const { readDocumentationResponse } = await load("../app/documentation-response.ts");

test("accepts documentation and JSON API errors", async () => {
  const result = { documentation: { intervention: { execution: { activities: [] } } } };
  assert.deepEqual(await readDocumentationResponse(Response.json(result)), result);
  assert.deepEqual(await readDocumentationResponse(Response.json({ error: "Autentificare necesară." }, { status: 401 })), { error: "Autentificare necesară." });
});

test("HTML failures explain that persistence is unconfirmed", async () => {
  await assert.rejects(readDocumentationResponse(new Response("<!DOCTYPE html><h1>Gateway timeout</h1>", { status: 504 })), /HTTP 504.*Salvarea nu a putut fi confirmată/);
  await assert.rejects(readDocumentationResponse(new Response("<!DOCTYPE html>", { status: 401 })), /Sesiunea a expirat/);
  await assert.rejects(readDocumentationResponse(new Response("null")), /răspuns neașteptat/);
});

test("saved documentation is acknowledged while external synchronization is pending", async () => {
  const route = await load("../app/api/documentation/route.ts", `
    export const background = [];
    const waitUntil = promise => background.push(promise);
    const sameOrigin = () => true;
    const currentSession = async () => ({ account: {} });
    const saveFieldDocumentation = async () => ({ documentation: { intervention: { execution: { activities: [{ id: "activity-1" }] } } } });
    let complete;
    export const finishSync = () => complete();
    const syncReportIfConnected = () => new Promise(resolve => { complete = resolve; });
  `);
  const response = await route.PATCH(new Request("https://orange.proconect.online/api/documentation", {
    method: "PATCH", body: JSON.stringify({ projectId: "ticket-1", section: "intervention", content: {} }),
  }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).documentation.intervention.execution.activities[0].id, "activity-1");
  assert.equal(route.background.length, 1);
  route.finishSync();
  await Promise.all(route.background);
});

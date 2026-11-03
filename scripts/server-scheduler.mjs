const baseUrl = process.env.APP_INTERNAL_URL || "http://app:3000";
const scheduledUrl = `${baseUrl}/__scheduled?cron=${encodeURIComponent("* * * * *")}`;
const intervalMs = 60_000;

async function trigger() {
  try {
    const response = await fetch(scheduledUrl, { method: "GET" });
    if (!response.ok) {
      console.error(`Scheduled job returned HTTP ${response.status}`);
    }
  } catch (error) {
    console.error("Scheduled job request failed", error instanceof Error ? error.message : error);
  }
}

await trigger();
setInterval(trigger, intervalMs);

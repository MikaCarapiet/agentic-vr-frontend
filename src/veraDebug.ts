export function logVeraDebug(event: string, detail?: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const payload = detail ? ` ${JSON.stringify(detail)}` : "";
  console.log(`[vera] ${event}${payload}`, detail ?? {});
}

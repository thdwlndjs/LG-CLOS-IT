export interface ConfirmationTarget {
  ownerId: string;
  kind: "plan" | "wear";
  targetId: string;
  date: string;
}
/** The same confirmed wear/plan stays idempotent across retries, reloads and tabs. */
export async function confirmationIntent(
  target: ConfirmationTarget,
): Promise<string> {
  const signature = JSON.stringify([
    target.ownerId,
    target.kind,
    target.targetId,
    target.date,
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(signature),
  );
  return `confirm-v1:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

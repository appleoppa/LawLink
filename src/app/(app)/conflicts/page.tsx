import { buildIntakeConflictQueries } from "@/lib/approvals/intake-detail";
import { decryptIdNumber } from "@/lib/clients/id-number-crypto";
import { getIntakeById } from "@/server/intakes/actions";
import { listMyRecentConflictChecks } from "@/server/conflicts/actions";
import { ConflictsViewV4 } from "./_components/conflicts-view-v4";

export default async function ConflictsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const intakeId = typeof params.intakeId === "string" ? params.intakeId : undefined;
  const intake = intakeId ? await getIntakeById(intakeId).catch(() => null) : null;
  const prefillName = typeof params.name === "string" ? params.name.slice(0, 100) : "";
  const recent = await listMyRecentConflictChecks().catch(() => []);
  return (
    <ConflictsViewV4
      intake={intake && !intake.teamReadOnly ? { id: intake.id, title: intake.title, receivedAt: new Date(intake.receivedAt).toISOString() } : null}
      initialQueries={intake && !intake.teamReadOnly ? buildIntakeConflictQueries(intake, decryptIdNumber) : []}
      recent={recent}
      prefillName={prefillName}
    />
  );
}

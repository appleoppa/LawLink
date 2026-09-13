import { listTeams } from "@/server/teams/actions";
import { listUsers } from "@/server/users/actions";
import { TeamsView } from "./_components/teams-view";

export default async function TeamsPage() {
  const [teams, users] = await Promise.all([listTeams(), listUsers()]);
  return <TeamsView teams={teams} users={users.map(({ id, name, role, active }) => ({ id, name, role, active }))} />;
}

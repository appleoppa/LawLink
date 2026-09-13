import { listClients } from "@/server/clients/actions";
import { ClientsView } from "./_components/clients-view";

type Props = {
  searchParams: Promise<{
    search?: string;
    type?: "INDIVIDUAL" | "COMPANY" | "ORGANIZATION";
    page?: string;
  }>;
};

export default async function ClientsPage({ searchParams }: Props) {
  const params = await searchParams;
  const initialData = await listClients({
    search: params.search,
    type: params.type,
    page: params.page ? Number(params.page) : 1
  });

  return (
    <ClientsView
      initialData={initialData}
      initialFilters={{
        search: params.search ?? "",
        type: params.type ?? "ALL"
      }}
    />
  );
}

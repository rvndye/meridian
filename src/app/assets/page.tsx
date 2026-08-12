export const dynamic = "force-dynamic";

import { getAccounts, getAssets, getAssetValuations } from "@/lib/repo";
import { PageHeader } from "@/components/ui";
import { AssetsView } from "./assets-view";

export default async function AssetsPage() {
  const [assets, valuations, accounts] = await Promise.all([
    getAssets(),
    getAssetValuations(),
    getAccounts(),
  ]);
  const liabilityAccounts = accounts
    .filter((a) => a.type === "credit_card" || a.type === "loan")
    .map((a) => ({
      id: a.id,
      name: `${a.institutionName} ${a.name}`,
      balance: a.currentBalance,
    }));

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="Property, vehicles, and other holdings tracked outside your connected accounts"
      />
      <AssetsView
        assets={assets}
        valuations={valuations}
        liabilityAccounts={liabilityAccounts}
      />
    </>
  );
}

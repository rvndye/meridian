export const dynamic = "force-dynamic";

import { getAccounts, getTransactions } from "@/lib/data";
import { PageHeader } from "@/components/ui";
import { TransactionsView } from "./transactions-view";

export default async function TransactionsPage() {
  const [accounts, txns] = await Promise.all([getAccounts(), getTransactions()]);
  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle={`${txns.length.toLocaleString()} transactions across ${accounts.length} accounts`}
      />
      <TransactionsView
        transactions={txns}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
      />
    </>
  );
}

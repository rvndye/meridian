import { PageHeader } from "@/components/ui";
import { AssistantChat } from "./assistant-chat";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  const configured = !!process.env.ANTHROPIC_API_KEY;
  return (
    <>
      <PageHeader
        title="AI Assistant"
        subtitle="Answers are computed from your actual transaction data — never invented"
      />
      <AssistantChat configured={configured} />
    </>
  );
}

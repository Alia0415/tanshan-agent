import { RoundtableWorkspace } from "@/components/roundtable-workspace";
export default async function RoundtablePage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
 const { q } = await searchParams;
 const question = typeof q === "string" ? q.slice(0, 1000) : "";
 return <RoundtableWorkspace key={question} initialQuestion={question} />;
}

import { Workspace } from "@/components/workspace";
export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
 const { q } = await searchParams;
 const question = typeof q === "string" ? q.slice(0, 1000) : "";
 return <Workspace key={question} initialQuestion={question} />;
}

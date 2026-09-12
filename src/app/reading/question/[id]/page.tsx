import { notFound } from "next/navigation";
import { getQuestion } from "@/lib/reading/discovery";
import QuestionReader from "@/app/reading/question-reader";
export const dynamic = "force-dynamic";
export default async function QuestionPage({params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  const question = await getQuestion(id);
  if (!question) notFound();
  return <QuestionReader key={question.id} question={question} />;
}

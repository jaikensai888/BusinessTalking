import { RecipeEditor } from "@/components/recipes/recipe-editor";

export default async function EditRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="px-6 py-10">
      <h1 className="text-[34px] font-semibold leading-[1.47] tracking-[-0.374px] mb-6">编辑配方</h1>
      <RecipeEditor recipeId={id} />
    </div>
  );
}
